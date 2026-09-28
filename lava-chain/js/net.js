// Room networking for Deadline. Adapted from Sumo Smash.

const PREFIX = 'yoahka-deadline-';
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RELAYS = ['wss://broker.emqx.io:8084/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }] };
const DIRECT_WAIT_MS = 8000;
const RELAY_SILENCE_MS = 12000;

export const makeCode = () => Array.from({ length: 5 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('');
const topicRoot = code => `yoahka-deadline/v1/${code}`;
const randomId = () => 'r' + Math.random().toString(36).slice(2, 12);

function loadMqtt() {
    if (window.mqtt) return Promise.resolve(true);
    return new Promise(resolve => {
        let n = 0;
        const iv = setInterval(() => {
            if (window.mqtt || ++n > 40) { clearInterval(iv); resolve(!!window.mqtt); }
        }, 200);
    });
}

function relayConnect(url) {
    return new Promise((resolve, reject) => {
        const client = window.mqtt.connect(url, { connectTimeout: 6000, reconnectPeriod: 2000, clean: true, clientId: `deadline_${Math.random().toString(16).slice(2, 12)}` });
        client.on('error', () => {});
        const timer = setTimeout(() => { client.end(true); reject(new Error('relay timeout')); }, 7000);
        client.once('connect', () => { clearTimeout(timer); resolve(client); });
    });
}

function parse(buf) { try { return JSON.parse(buf.toString()); } catch (e) { return null; } }

// Relay messages are numbered: the host and players use every relay they can reach, so the same
// message can arrive once per relay (and the relay itself may deliver twice). Each copy is used once.
class SeenWindow {
    constructor() { this.set = new Set(); this.order = []; }
    fresh(n) {
        if (this.set.has(n)) return false;
        this.set.add(n);
        this.order.push(n);
        if (this.order.length > 400) this.set.delete(this.order.shift());
        return true;
    }
}

export class HostNet {
    constructor({ onMessage, onLeave }) {
        this.onMessage = onMessage;
        this.onLeave = onLeave;
        this.conns = new Map();
        this.relayPeers = new Map();
        this.relays = [];
        this.seq = 0;
    }
    open(code) {
        if (!window.Peer) return Promise.reject(new Error('The multiplayer library did not load.'));
        return new Promise((resolve, reject) => {
            const peer = new window.Peer(PREFIX + code, { debug: 0, config: ICE });
            this.peer = peer;
            const timer = setTimeout(() => reject(new Error('Could not reach the multiplayer server.')), 12000);
            peer.on('open', () => { clearTimeout(timer); this.startRelays(code); resolve(); });
            peer.on('error', err => { clearTimeout(timer); reject(new Error(err.type === 'unavailable-id' ? 'code-taken' : 'Could not reach the multiplayer server.')); });
            peer.on('connection', conn => {
                conn.on('open', () => this.conns.set(conn.peer, conn));
                conn.on('data', data => this.onMessage(conn.peer, data));
                const gone = () => { if (this.conns.delete(conn.peer)) this.onLeave(conn.peer); };
                conn.on('close', gone); conn.on('error', gone);
            });
            peer.on('disconnected', () => { try { if (!peer.destroyed) peer.reconnect(); } catch (e) {} });
        });
    }
    async startRelays(code) {
        this.root = topicRoot(code);
        if (!(await loadMqtt())) return;
        for (const url of RELAYS) {
            relayConnect(url).then(client => {
                if (this.closed) return client.end(true);
                const relay = { client, url };
                this.relays.push(relay);
                client.subscribe(`${this.root}/h`, { qos: 1 });
                client.on('message', (_, buf) => this.onRelay(relay, buf));
            }).catch(() => {});
        }
        this.housekeeping = setInterval(() => this.relayHousekeeping(), 2000);
    }
    onRelay(relay, buf) {
        const env = parse(buf);
        if (!env || typeof env.f !== 'string' || !env.m || typeof env.m !== 'object') return;
        const id = env.f, msg = env.m;
        if (this.conns.has(id)) return;
        let p = this.relayPeers.get(id);
        if (msg.t === 'bye') { if (p) { this.relayPeers.delete(id); this.onLeave(id); } return; }
        if (!p) { if (msg.t !== 'hello') return; p = { relays: new Set(), seen: new SeenWindow(), last: 0 }; this.relayPeers.set(id, p); }
        p.last = Date.now();
        p.relays.add(relay); // reply on every relay this player has reached us through
        if (typeof env.s === 'number' && !p.seen.fresh(env.s)) return;
        if (msg.t !== 'ping') this.onMessage(id, msg);
    }
    relayHousekeeping() {
        const now = Date.now();
        for (const [id, p] of this.relayPeers) { if (now - p.last > RELAY_SILENCE_MS) { this.relayPeers.delete(id); this.onLeave(id); } }
        if (this.relayPeers.size) this.publishAll({ t: 'hb' }, 0);
    }
    publishAll(msg, qos) {
        const used = new Set();
        for (const p of this.relayPeers.values()) for (const r of p.relays) used.add(r);
        const payload = JSON.stringify({ s: ++this.seq, m: msg });
        for (const r of used) r.client.publish(`${this.root}/all`, payload, { qos });
    }
    send(id, msg) {
        const c = this.conns.get(id); if (c && c.open) return c.send(msg);
        const p = this.relayPeers.get(id);
        if (!p) return;
        const payload = JSON.stringify({ s: ++this.seq, m: msg });
        for (const r of p.relays) r.client.publish(`${this.root}/c/${id}`, payload, { qos: 1 });
    }
    broadcast(msg) {
        for (const c of this.conns.values()) if (c.open) c.send(msg);
        if (this.relayPeers.size) this.publishAll(msg, 1);
    }
    kick(id) { const c = this.conns.get(id); if (c) c.close(); this.relayPeers.delete(id); }
    close() {
        this.closed = true; clearInterval(this.housekeeping);
        if (this.relayPeers.size) this.publishAll({ t: 'closed' }, 1);
        const relays = this.relays; setTimeout(() => relays.forEach(r => r.client.end(true)), 400);
        if (this.peer) this.peer.destroy(); this.conns.clear(); this.relayPeers.clear();
    }
}

export class ClientNet {
    constructor({ onMessage, onClose, onStatus, forceRelay }) {
        this.onMessage = onMessage; this.onClose = onClose;
        this.onStatus = onStatus || (() => {}); this.forceRelay = !!forceRelay;
    }
    async connect(code) {
        this.root = topicRoot(code);
        if (this.forceRelay) return this.connectRelay();
        try { return await this.connectDirect(code); } catch (e) { if (e.definitive) throw e; }
        this.onStatus('Direct connection blocked. Trying the relay...');
        return this.connectRelay();
    }
    connectDirect(code) {
        return new Promise((resolve, reject) => {
            if (!window.Peer) return reject(new Error('no peerjs'));
            const peer = new window.Peer({ debug: 0, config: ICE }); this.peer = peer;
            let settled = false;
            const fail = (msg, definitive) => { if (settled) return; settled = true; clearTimeout(timer); const err = new Error(msg); err.definitive = !!definitive; reject(err); };
            const timer = setTimeout(() => fail('timeout'), 12000);
            peer.on('open', id => {
                this.id = id;
                const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
                conn.on('open', () => { if (settled) return conn.close(); settled = true; clearTimeout(timer); this.conn = conn; this.mode = 'direct'; resolve(id); });
                conn.on('data', d => this.onMessage(d));
                conn.on('close', () => { if (this.conn === conn && !this.closing) this.onClose(); });
                conn.on('iceStateChanged', s => { if (s === 'failed') fail('ice failed'); });
                setTimeout(() => fail('direct too slow'), DIRECT_WAIT_MS);
            });
            // The matchmaking server can lose track of a host whose tab briefly slept, while the host is still
            // listening on the relay, so don't give up here: fall through to the relay and let the game's
            // join timeout decide whether the room really exists.
            peer.on('error', err => fail(err.type)); // includes peer-unavailable: try the relay first
        });
    }
    // Join through EVERY relay we can reach, not just the first. If the host's network can only reach one
    // of them, we still meet there. Resolves as soon as one relay is ready; the others join in as they connect.
    async connectRelay() {
        if (this.peer) { try { this.peer.destroy(); } catch (e) {} this.peer = null; }
        if (!this.id) this.id = randomId();
        if (!(await loadMqtt())) throw new Error('Could not connect.');
        this.relays = [];
        this.seq = 0;
        this.seen = new SeenWindow();
        this.outbox = []; // recent messages, replayed to a relay that connects late (the host dedupes by number)
        this.mode = 'relay';
        this.lastHeard = Date.now();
        const attempts = RELAYS.map(url => relayConnect(url).then(client => new Promise((res, rej) => {
            client.subscribe([`${this.root}/c/${this.id}`, `${this.root}/all`], { qos: 1 }, e => {
                if (e) { client.end(true); return rej(e); }
                if (this.closing) { client.end(true); return rej(new Error('closed')); }
                client.on('message', (_, buf) => this.onRelayMessage(buf));
                this.relays.push(client);
                // A relay that connects after we've already said hello (and more) gets caught up
                for (const o of this.outbox) client.publish(`${this.root}/h`, o.payload, { qos: o.qos });
                res(client);
            });
        })));
        try {
            await Promise.any(attempts);
        } catch (e) {
            throw new Error('Could not connect. This network may be blocking online games.');
        }
        this.pingTimer = setInterval(() => {
            this.publish({ t: 'ping' }, 0);
            if (Date.now() - this.lastHeard > 15000 && !this.closing) { clearInterval(this.pingTimer); this.onClose(); }
        }, 3000);
        return this.id;
    }
    onRelayMessage(buf) {
        const env = parse(buf);
        if (!env || typeof env !== 'object') return;
        let m = env;
        if (env.m && typeof env.m === 'object') {
            if (typeof env.s === 'number' && !this.seen.fresh(env.s)) return; // same message via another relay
            m = env.m;
        }
        this.lastHeard = Date.now();
        if (m.t === 'hb') return;
        if (m.t === 'closed') { if (!this.closing) this.onClose(); return; }
        this.onMessage(m);
    }
    publish(msg, qos) {
        const payload = JSON.stringify({ f: this.id, s: ++this.seq, m: msg });
        for (const c of this.relays) c.publish(`${this.root}/h`, payload, { qos });
        if (msg.t !== 'ping') {
            this.outbox.push({ payload, qos });
            if (this.outbox.length > 30) this.outbox.shift();
        }
    }
    send(msg) {
        if (this.mode === 'direct') { if (this.conn && this.conn.open) this.conn.send(msg); }
        else if (this.mode === 'relay') this.publish(msg, 1);
    }
    close() {
        this.closing = true; clearInterval(this.pingTimer);
        if (this.relays && this.relays.length) {
            try { this.publish({ t: 'bye' }, 0); } catch (e) {}
            const rs = this.relays;
            setTimeout(() => rs.forEach(r => r.end(true)), 300);
        }
        if (this.peer) this.peer.destroy();
    }
}

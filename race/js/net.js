// Room networking. One player hosts the room in their browser; everyone else connects to them.
//
// Two ways to reach the host:
//   1. Direct (WebRTC via PeerJS): fastest, used whenever the two networks allow it.
//   2. Relay (MQTT over a secure WebSocket on port 443): used automatically when a direct
//      link can't be made, e.g. on mobile data or strict Wi-Fi. Slightly slower, works almost anywhere.
// The host listens on both at once, so it doesn't matter which one each friend ends up on.

const PREFIX = 'yoahka-bonk-';
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RELAYS = ['wss://broker.emqx.io:8084/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
// STUN only: PeerJS's built-in TURN servers no longer exist, and the relay above replaces them
const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }] };
const DIRECT_WAIT_MS = 8000;      // how long to try a direct link once the room is found
const RELAY_SILENCE_MS = 12000;   // drop a relay player we haven't heard from in this long

export const makeCode = () => Array.from({ length: 5 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('');
const topicRoot = code => `yoahka-bonk/v1/${code}`;
const randomId = () => 'r' + Math.random().toString(36).slice(2, 12);

function loadMqtt() {
    if (window.mqtt) return Promise.resolve(true);
    return new Promise(resolve => {
        let n = 0;
        const iv = setInterval(() => {
            if (window.mqtt || ++n > 40) {
                clearInterval(iv);
                resolve(!!window.mqtt);
            }
        }, 200);
    });
}

function relayConnect(url) {
    return new Promise((resolve, reject) => {
        const client = window.mqtt.connect(url, { connectTimeout: 6000, reconnectPeriod: 2000, clean: true, clientId: `bonk_${Math.random().toString(16).slice(2, 12)}` });
        client.on('error', () => { /* reconnects on its own; failures surface via the timeout */ });
        const timer = setTimeout(() => { client.end(true); reject(new Error('relay timeout')); }, 7000);
        client.once('connect', () => { clearTimeout(timer); resolve(client); });
    });
}

function parse(buf) {
    try { return JSON.parse(buf.toString()); } catch (e) { return null; }
}

// ============================================================
// Host
// ============================================================
export class HostNet {
    constructor({ onMessage, onLeave }) {
        this.onMessage = onMessage;
        this.onLeave = onLeave;
        this.conns = new Map();       // direct connections: id -> PeerJS DataConnection
        this.relayPeers = new Map();  // relay players: id -> { relay, last }
        this.relays = [];
    }

    open(code) {
        if (!window.Peer) return Promise.reject(new Error('The multiplayer library did not load. Check your connection, or race solo.'));
        return new Promise((resolve, reject) => {
            const peer = new window.Peer(PREFIX + code, { debug: 0, config: ICE });
            this.peer = peer;
            const timer = setTimeout(() => reject(new Error('Could not reach the multiplayer server. Try again, or race solo.')), 12000);
            peer.on('open', () => {
                clearTimeout(timer);
                this.startRelays(code);
                resolve();
            });
            peer.on('error', err => {
                clearTimeout(timer);
                reject(new Error(err.type === 'unavailable-id' ? 'code-taken' : 'Could not reach the multiplayer server. Try again, or race solo.'));
            });
            peer.on('connection', conn => {
                conn.on('open', () => this.conns.set(conn.peer, conn));
                conn.on('data', data => this.onMessage(conn.peer, data));
                const gone = () => { if (this.conns.delete(conn.peer)) this.onLeave(conn.peer); };
                conn.on('close', gone);
                conn.on('error', gone);
            });
            // Keep the room reachable if the signalling socket drops for a moment
            peer.on('disconnected', () => { try { if (!peer.destroyed) peer.reconnect(); } catch (e) { /* ignore */ } });
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
            }).catch(() => { /* that relay is down; the other may still work */ });
        }
        this.housekeeping = setInterval(() => this.relayHousekeeping(), 2000);
    }

    onRelay(relay, buf) {
        const env = parse(buf);
        if (!env || typeof env.f !== 'string' || !env.m || typeof env.m !== 'object') return;
        const id = env.f, msg = env.m;
        if (this.conns.has(id)) return;
        let p = this.relayPeers.get(id);
        if (msg.t === 'bye') {
            if (p) { this.relayPeers.delete(id); this.onLeave(id); }
            return;
        }
        if (!p) {
            if (msg.t !== 'hello') return;
            p = { relay, last: 0 };
            this.relayPeers.set(id, p);
        }
        p.last = Date.now();
        p.relay = relay;
        if (msg.t !== 'ping') this.onMessage(id, msg);
    }

    relayHousekeeping() {
        const now = Date.now();
        for (const [id, p] of this.relayPeers) {
            if (now - p.last > RELAY_SILENCE_MS) {
                this.relayPeers.delete(id);
                this.onLeave(id);
            }
        }
        if (this.relayPeers.size) this.publishAll({ t: 'hb' }, 0);
    }

    publishAll(msg, qos) {
        const used = new Set([...this.relayPeers.values()].map(p => p.relay));
        const payload = JSON.stringify(msg);
        for (const r of used) r.client.publish(`${this.root}/all`, payload, { qos });
    }

    send(id, msg) {
        const c = this.conns.get(id);
        if (c && c.open) return c.send(msg);
        const p = this.relayPeers.get(id);
        if (p) p.relay.client.publish(`${this.root}/c/${id}`, JSON.stringify(msg), { qos: 1 });
    }

    broadcast(msg) {
        for (const c of this.conns.values()) if (c.open) c.send(msg);
        if (!this.relayPeers.size) return;
        if (msg.t === 'sts') {
            // Positions go over the relay at half rate (10 a second); the game smooths between them
            this.stsTick = !this.stsTick;
            if (this.stsTick) this.publishAll(msg, 0);
        } else {
            this.publishAll(msg, 1);
        }
    }

    kick(id) {
        const c = this.conns.get(id);
        if (c) c.close();
        this.relayPeers.delete(id);
    }

    close() {
        this.closed = true;
        clearInterval(this.housekeeping);
        if (this.relayPeers.size) this.publishAll({ t: 'closed' }, 1);
        const relays = this.relays;
        setTimeout(() => relays.forEach(r => r.client.end(true)), 400);
        if (this.peer) this.peer.destroy();
        this.conns.clear();
        this.relayPeers.clear();
    }
}

// ============================================================
// Client
// ============================================================
export class ClientNet {
    constructor({ onMessage, onClose, onStatus, forceRelay }) {
        this.onMessage = onMessage;
        this.onClose = onClose;
        this.onStatus = onStatus || (() => {});
        this.forceRelay = !!forceRelay;
    }

    async connect(code) {
        this.root = topicRoot(code);
        if (this.forceRelay) return this.connectRelay();
        try {
            return await this.connectDirect(code);
        } catch (e) {
            if (e.definitive) throw e;
        }
        this.onStatus('Direct connection blocked on this network. Trying the relay...');
        return this.connectRelay();
    }

    connectDirect(code) {
        return new Promise((resolve, reject) => {
            if (!window.Peer) return reject(new Error('no peerjs'));
            const peer = new window.Peer({ debug: 0, config: ICE });
            this.peer = peer;
            let settled = false;
            const fail = (msg, definitive) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                const err = new Error(msg);
                err.definitive = !!definitive;
                reject(err);
            };
            const timer = setTimeout(() => fail('timeout'), 12000);
            peer.on('open', id => {
                this.id = id;
                const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
                conn.on('open', () => {
                    if (settled) return conn.close();
                    settled = true;
                    clearTimeout(timer);
                    this.conn = conn;
                    this.mode = 'direct';
                    resolve(id);
                });
                conn.on('data', d => this.onMessage(d));
                conn.on('close', () => { if (this.conn === conn && !this.closing) this.onClose(); });
                conn.on('iceStateChanged', s => { if (s === 'failed') fail('ice failed'); });
                setTimeout(() => fail('direct too slow'), DIRECT_WAIT_MS);
            });
            peer.on('error', err => {
                if (err.type === 'peer-unavailable') fail('No room found with that code. Check it and try again.', true);
                else fail(err.type);
            });
        });
    }

    async connectRelay() {
        if (this.peer) {
            try { this.peer.destroy(); } catch (e) { /* ignore */ }
            this.peer = null;
        }
        if (!this.id) this.id = randomId();
        if (!(await loadMqtt())) throw new Error('Could not connect. This network may be blocking online games.');
        for (const url of RELAYS) {
            let client;
            try {
                client = await relayConnect(url);
                await new Promise((res, rej) => client.subscribe([`${this.root}/c/${this.id}`, `${this.root}/all`], { qos: 1 }, e => (e ? rej(e) : res())));
            } catch (e) {
                if (client) client.end(true);
                continue;
            }
            this.relay = client;
            this.mode = 'relay';
            this.lastHeard = Date.now();
            client.on('message', (_, buf) => {
                const m = parse(buf);
                if (!m || typeof m !== 'object') return;
                this.lastHeard = Date.now();
                if (m.t === 'hb') return;
                if (m.t === 'closed') { if (!this.closing) this.onClose(); return; }
                this.onMessage(m);
            });
            this.pingTimer = setInterval(() => {
                this.publish({ t: 'ping' }, 0);
                if (Date.now() - this.lastHeard > 15000 && !this.closing) {
                    clearInterval(this.pingTimer);
                    this.onClose();
                }
            }, 3000);
            return this.id;
        }
        throw new Error('Could not connect. This network may be blocking online games.');
    }

    publish(msg, qos) {
        this.relay.publish(`${this.root}/h`, JSON.stringify({ f: this.id, m: msg }), { qos });
    }

    send(msg) {
        if (this.mode === 'direct') {
            if (this.conn && this.conn.open) this.conn.send(msg);
        } else if (this.mode === 'relay') {
            if (msg.t === 'st') {
                // Our position goes at half rate over the relay
                this.stTick = !this.stTick;
                if (this.stTick) this.publish(msg, 0);
            } else {
                this.publish(msg, 1);
            }
        }
    }

    close() {
        this.closing = true;
        clearInterval(this.pingTimer);
        if (this.relay) {
            try { this.publish({ t: 'bye' }, 0); } catch (e) { /* ignore */ }
            const r = this.relay;
            setTimeout(() => r.end(true), 300);
        }
        if (this.peer) this.peer.destroy();
    }
}

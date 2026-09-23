// Minimal room networking over WebRTC, using PeerJS for matchmaking.
// One player hosts the room in their browser; everyone else connects straight to them.

const PREFIX = 'yoahka-bonk-';
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const makeCode = () => Array.from({ length: 5 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('');

function requirePeer() {
    if (!window.Peer) throw new Error('The multiplayer library did not load. Check your connection, or race solo.');
}

export class HostNet {
    constructor({ onMessage, onLeave }) {
        this.onMessage = onMessage;
        this.onLeave = onLeave;
        this.conns = new Map();
    }

    open(code) {
        requirePeer();
        return new Promise((resolve, reject) => {
            const peer = new window.Peer(PREFIX + code, { debug: 0 });
            this.peer = peer;
            const timer = setTimeout(() => reject(new Error('Could not reach the multiplayer server. Try again, or race solo.')), 12000);
            peer.on('open', () => { clearTimeout(timer); resolve(); });
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

    send(id, msg) {
        const c = this.conns.get(id);
        if (c && c.open) c.send(msg);
    }

    broadcast(msg) {
        for (const c of this.conns.values()) if (c.open) c.send(msg);
    }

    kick(id) {
        const c = this.conns.get(id);
        if (c) c.close();
    }

    close() {
        if (this.peer) this.peer.destroy();
        this.conns.clear();
    }
}

export class ClientNet {
    constructor({ onMessage, onClose }) {
        this.onMessage = onMessage;
        this.onClose = onClose;
    }

    connect(code) {
        requirePeer();
        return new Promise((resolve, reject) => {
            const peer = new window.Peer({ debug: 0 });
            this.peer = peer;
            let settled = false;
            const fail = msg => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error(msg)); } };
            const timer = setTimeout(() => fail('Could not connect. Check the room code and try again.'), 15000);
            peer.on('open', () => {
                const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
                this.conn = conn;
                conn.on('open', () => { settled = true; clearTimeout(timer); resolve(peer.id); });
                conn.on('data', data => this.onMessage(data));
                conn.on('close', () => { if (settled && !this.closing) this.onClose(); });
                conn.on('error', () => { if (settled && !this.closing) this.onClose(); });
            });
            peer.on('error', err => {
                if (err.type === 'peer-unavailable') fail('No room found with that code.');
                else if (!settled) fail('Connection failed. Try again, or race solo.');
            });
        });
    }

    send(msg) {
        if (this.conn && this.conn.open) this.conn.send(msg);
    }

    close() {
        this.closing = true;
        if (this.peer) this.peer.destroy();
    }
}

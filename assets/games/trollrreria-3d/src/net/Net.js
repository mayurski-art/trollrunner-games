import { buildWorldSnapshot, applyWorldSave } from '../world/Save.js';
import { PeerGhost } from './PeerGhost.js';

// Same Supabase project already used by the 2D Trollrreria's co-op
// (assets/games/trollrreria/src/net.js) — one project backs every game's
// realtime rooms, no new credentials/setup needed.
const SUPABASE_URL = 'https://tjsyhfplxjtakdfkpdtg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqc3loZnBseGp0YWtkZmtwZHRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzOTc0ODksImV4cCI6MjA5MTk3MzQ4OX0.xLUcPUUguRBQttNwiIRWJHxjJjLqrQDMu4Ubsk5yZoQ';

const POS_SEND_INTERVAL = 0.12; // ~8Hz
const PEER_TIMEOUT_MS = 8000;

class BroadcastTransport {
  constructor() { this.kind = 'tabs'; }
  connect(room, onMsg) {
    this.ch = new BroadcastChannel('trollrreria3d:' + room);
    this.ch.onmessage = (e) => onMsg(e.data);
    return Promise.resolve(true);
  }
  send(msg) { try { this.ch?.postMessage(msg); } catch { /* payload too big etc */ } }
  close() { this.ch?.close(); this.ch = null; }
}

class SupabaseTransport {
  constructor() { this.kind = 'online'; }
  connect(room, onMsg) {
    return new Promise((resolve) => {
      try {
        if (!window.supabase?.createClient) return resolve(false);
        this.client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: { persistSession: false },
          realtime: { params: { eventsPerSecond: 20 } },
        });
        this.chan = this.client.channel('trollrreria3d:' + room, { config: { broadcast: { self: false } } });
        this.chan.on('broadcast', { event: 'tr3' }, (p) => onMsg(p.payload));
        const timeout = setTimeout(() => resolve(false), 6000);
        this.chan.subscribe((status) => {
          if (status === 'SUBSCRIBED') { clearTimeout(timeout); resolve(true); }
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(timeout); resolve(false); }
        });
      } catch {
        resolve(false);
      }
    });
  }
  send(msg) {
    try { this.chan?.send({ type: 'broadcast', event: 'tr3', payload: msg }); } catch { /* non-fatal */ }
  }
  close() {
    try { this.chan && this.client.removeChannel(this.chan); } catch { /* ignore */ }
    this.chan = null;
  }
}

// Enemies stay local to each player (same documented tradeoff as the 2D
// game's co-op: "every player fights their own monsters") — only the
// shared world (terrain/chests/wiring) and player positions/edits sync.
export class Net {
  constructor(game) {
    this.game = game;
    this.transport = null;
    this.room = null;
    this.isHost = false;
    this.connected = false;
    this.applying = false; // true while applying a remote edit — suppresses re-broadcast
    this.id = Math.random().toString(36).slice(2, 10);
    this.peers = new Map(); // id -> PeerGhost
    this.posTimer = 0;
  }

  get active() { return this.connected; }
  get peerCount() { return this.peers.size; }

  static makeCode() {
    const abc = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 5; i++) s += abc[Math.floor(Math.random() * abc.length)];
    return s;
  }

  async start(room, asHost) {
    this.stop();
    this.room = room.toUpperCase();
    this.isHost = asHost;
    let t = new SupabaseTransport();
    let ok = await t.connect(this.room, (m) => this.onMessage(m));
    if (!ok) {
      t = new BroadcastTransport();
      ok = await t.connect(this.room, (m) => this.onMessage(m));
    }
    if (!ok) return null;

    this.transport = t;
    this.connected = true;
    this.hookWorld();
    if (!asHost) this.send({ t: 'hello', id: this.id });
    return { kind: t.kind };
  }

  stop() {
    if (this.transport) {
      this.send({ t: 'bye', id: this.id });
      this.transport.close();
    }
    this.transport = null;
    this.connected = false;
    for (const peer of this.peers.values()) peer.dispose(this.game.scene);
    this.peers.clear();
    if (this.game.world) this.game.world.onEdit = null;
  }

  send(msg) {
    this.transport?.send(msg);
  }

  // Broadcast local world edits (World calls this on every setBlock).
  hookWorld() {
    this.game.world.onEdit = (x, y, z, blockId) => {
      if (this.applying) return;
      this.send({ t: 'edit', id: this.id, x, y, z, v: blockId });
    };
  }

  update(dt, playerPos, playerYaw) {
    if (!this.connected) return;
    this.posTimer -= dt;
    if (this.posTimer <= 0) {
      this.posTimer = POS_SEND_INTERVAL;
      this.send({ t: 'pos', id: this.id, x: playerPos.x, y: playerPos.y, z: playerPos.z, yaw: playerYaw });
    }
    for (const peer of this.peers.values()) peer.update(dt);

    const now = performance.now();
    for (const [id, peer] of this.peers) {
      if (now - (peer.lastSeen || 0) > PEER_TIMEOUT_MS) {
        peer.dispose(this.game.scene);
        this.peers.delete(id);
      }
    }
  }

  onMessage(m) {
    if (!m || m.id === this.id) return;
    switch (m.t) {
      case 'hello':
        if (this.isHost) this.sendWorldSnapshot(m.id);
        break;
      case 'world':
        if (m.to !== this.id) break;
        this.applying = true;
        applyWorldSave(this.game.world, m.data);
        this.applying = false;
        this.game.onCoopWorldReceived?.();
        break;
      case 'pos':
        this.upsertPeer(m.id, m.x, m.y, m.z, m.yaw);
        break;
      case 'edit':
        this.applying = true;
        this.game.world.setBlock(m.x, m.y, m.z, m.v);
        this.applying = false;
        break;
      case 'lever':
        this.applying = true;
        this.game.world.toggleLever(m.x, m.y, m.z);
        this.applying = false;
        break;
      case 'bye':
        this.peers.get(m.id)?.dispose(this.game.scene);
        this.peers.delete(m.id);
        break;
    }
  }

  sendWorldSnapshot(toId) {
    this.send({ t: 'world', id: this.id, to: toId, data: buildWorldSnapshot(this.game.world) });
  }

  // Called by Game.js whenever the local player toggles a lever, so peers'
  // leverStates (and therefore their own recomputePower) stay in sync too.
  broadcastLever(x, y, z) {
    if (this.connected) this.send({ t: 'lever', id: this.id, x, y, z });
  }

  upsertPeer(id, x, y, z, yaw) {
    let peer = this.peers.get(id);
    if (!peer) {
      peer = new PeerGhost(this.game.scene);
      this.peers.set(id, peer);
    }
    peer.setTarget(x, y, z, yaw);
    peer.lastSeen = performance.now();
  }
}

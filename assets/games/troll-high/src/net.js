/* Troll High — per-zone multiplayer: ghosts, presence, chat, emotes.

   Mirrors Trollrreria's transport pattern (assets/games/trollrreria/src/net.js):
   Supabase Realtime broadcast+presence over the internet, BroadcastChannel
   as an automatic same-browser-tabs fallback. Unlike Trollrreria this has
   no shared-world simulation to host — every client only ever owns its own
   avatar, so there's no host bottleneck and no edit fan-out, just ghosts. */

const SUPABASE_URL = "https://tjsyhfplxjtakdfkpdtg.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqc3loZnBseGp0YWtkZmtwZHRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzOTc0ODksImV4cCI6MjA5MTk3MzQ4OX0.xLUcPUUguRBQttNwiIRWJHxjJjLqrQDMu4Ubsk5yZoQ";

const GHOST_TIMEOUT_MS = 8000;   // drop a peer if no update arrives this long
const POS_HZ = 10;

/* ------------------------------------------------------------ transports */
class BroadcastTransport {
  constructor() { this.kind = "tabs"; }
  connect(room, onMsg) {
    this.ch = new BroadcastChannel("trollhigh:" + room);
    this.ch.onmessage = e => onMsg(e.data);
    return Promise.resolve(true);
  }
  send(msg) { try { this.ch && this.ch.postMessage(msg); } catch (e) { /* ignore */ } }
  close() { this.ch && this.ch.close(); this.ch = null; }
}

class SupabaseTransport {
  constructor() { this.kind = "online"; }
  connect(room, onMsg, onPresence) {
    return new Promise(resolve => {
      try {
        if (!window.supabase || !window.supabase.createClient) return resolve(false);
        this.client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: { persistSession: false },
          realtime: { params: { eventsPerSecond: 20 } },
        });
        this.chan = this.client.channel("trollhigh:" + room, {
          config: { broadcast: { self: false }, presence: { key: this._presenceKey } },
        });
        this.chan.on("broadcast", { event: "th" }, p => onMsg(p.payload));
        if (onPresence) this.chan.on("presence", { event: "sync" }, () => onPresence(this.chan.presenceState()));
        const timeout = setTimeout(() => resolve(false), 6000);
        this.chan.subscribe(status => {
          if (status === "SUBSCRIBED") { clearTimeout(timeout); resolve(true); }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { clearTimeout(timeout); resolve(false); }
        });
      } catch (e) { resolve(false); }
    });
  }
  send(msg) {
    try { this.chan && this.chan.send({ type: "broadcast", event: "th", payload: msg }); }
    catch (e) { /* non-fatal */ }
  }
  /* Untrack before re-track: Realtime presence metas accumulate under a key
     rather than replacing on re-track, so always drop the old one first. */
  track(meta) {
    if (!this.chan) return;
    this.chan.untrack().finally(() => this.chan.track({ ...meta, trackedAt: Date.now() }));
  }
  close() {
    try { this.chan && this.client.removeChannel(this.chan); } catch (e) { /* ignore */ }
    this.chan = null;
  }
}

/* -------------------------------------------------------------- Net */
export class Net {
  constructor({ id, name }) {
    this.id = id;
    this.name = name;
    this.transport = null;
    this.room = null;
    this.connected = false;
    this.peers = new Map();     // id -> { x, y, dir, moving, name, last }
    this._posAcc = 0;

    this.onChat = null;         // (peerId, name, text) => void
    this.onEmote = null;        // (peerId, name, emoji) => void
    this.onRosterChange = null; // (names: string[]) => void
  }

  async join(room) {
    await this.leave();
    this.room = room;
    this.peers.clear();

    this.transport = new SupabaseTransport();
    this.transport._presenceKey = this.id;
    let ok = await this.transport.connect(room, m => this._onMessage(m), state => this._onPresence(state));
    if (!ok) {
      this.transport = new BroadcastTransport();
      ok = await this.transport.connect(room, m => this._onMessage(m));
    }
    this.connected = ok;
    if (this.transport.track) this.transport.track({ name: this.name });
    return ok;
  }

  async leave() {
    if (this.transport) { this.transport.close(); this.transport = null; }
    this.connected = false;
    this.room = null;
    this.peers.clear();
  }

  _onMessage(m) {
    if (!m || m.id === this.id) return;
    if (m.t === "pos") {
      this.peers.set(m.id, { x: m.x, y: m.y, dir: m.dir, moving: m.moving, name: m.name, last: performance.now() });
    } else if (m.t === "chat" && this.onChat) {
      this.onChat(m.id, m.name, m.text);
    } else if (m.t === "emote" && this.onEmote) {
      this.onEmote(m.id, m.name, m.emoji);
    }
  }

  _onPresence(state) {
    if (!this.onRosterChange) return;
    // freshest trackedAt wins per key (see whos-online precedent)
    const names = Object.values(state).map(metas =>
      metas.slice().sort((a, b) => (b.trackedAt || 0) - (a.trackedAt || 0))[0]?.name
    ).filter(Boolean);
    this.onRosterChange(names);
  }

  /* Call every frame; throttles the actual network send to POS_HZ. */
  sendPosition(dt, player) {
    if (!this.connected) return;
    this._posAcc += dt;
    if (this._posAcc < 1 / POS_HZ) return;
    this._posAcc = 0;
    this.transport.send({
      t: "pos", id: this.id, name: this.name,
      x: Math.round(player.x), y: Math.round(player.y),
      dir: player.dir, moving: player.moving,
    });
  }

  sendChat(text) {
    if (!this.connected) return;
    this.transport.send({ t: "chat", id: this.id, name: this.name, text });
  }

  sendEmote(emoji) {
    if (!this.connected) return;
    this.transport.send({ t: "emote", id: this.id, name: this.name, emoji });
  }

  /* Prune peers that stopped sending updates, and return live ones. */
  liveGhosts() {
    const now = performance.now();
    for (const [id, p] of this.peers) if (now - p.last > GHOST_TIMEOUT_MS) this.peers.delete(id);
    return this.peers;
  }
}

export function makeGuestIdentity() {
  const adjectives = ["Sneaky", "Chunky", "Feral", "Salty", "Chill", "Wired", "Goofy", "Loud"];
  const id = Math.random().toString(36).slice(2, 10);
  const name = adjectives[Math.floor(Math.random() * adjectives.length)] + "Troll" + Math.floor(100 + Math.random() * 900);
  return { id, name };
}

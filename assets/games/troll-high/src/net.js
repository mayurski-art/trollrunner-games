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
    this.club = null;           // real multi-club system (§23 Phase 6) — this
                                 // player's club name, or null if unaffiliated
    this.running = false;       // student elections (§23 Phase 6) — is this
                                 // player currently a declared candidate?
    this.dancing = false;       // dances (§23 Phase 6) — is this player
                                 // currently on the dance floor?
    this.performing = false;    // talent show (§23 Phase 6) — is this
                                 // player currently on stage?
    this.project = null;        // science fair (§23 Phase 6) — this
                                 // player's active project title, or null
    this.graduated = false;     // graduation (§23 Phase 6 capstone) — a
                                 // persisted trait (unlike the other four,
                                 // which are all session-scoped toggles)
    this.transport = null;
    this.room = null;
    this.connected = false;
    this.peers = new Map();     // id -> { x, y, dir, moving, name, club, last }
    this._posAcc = 0;

    this.onChat = null;         // (peerId, name, text) => void
    this.onEmote = null;        // (peerId, name, emoji) => void
    this.onRosterChange = null; // (names: string[]) => void

    // Trading + gifting (Phase 7) — each side only ever mutates its own
    // inventory, in response to a message from the other client. There's
    // no server-arbitrated trade ledger; see cards.js for why that's fine
    // for flavor-only collectibles.
    this.onTradeOffer = null;   // (peerId, name, offerCards: {id,count}[]) => void
    this.onTradeAccept = null;  // (peerId, name, counterCards: {id,count}[]) => void
    this.onTradeDecline = null; // (peerId, name) => void
    this.onGift = null;         // (peerId, name, cardId) => void

    // Student elections (§23 Phase 6) — a live, session-scoped poll, not a
    // persisted ballot: candidacy broadcasts over presence like club does,
    // and votes are a lightweight broadcast message each client tallies
    // itself (no server-arbitrated count, same trust model as trading).
    this.onVote = null;         // (voterId, voterName, forId) => void

    // Graduation (§23 Phase 6 capstone) — a one-shot announcement so
    // anyone nearby at the moment sees it live, distinct from the
    // persisted `graduated` presence flag (which just marks a 🎓 tag from
    // then on, every session).
    this.onGraduationAnnounce = null; // (peerId, name) => void

    // "Living MMO" unscripted moments (§21/§23) — a food fight is
    // inherently social, so it gets the same one-shot live-announcement
    // treatment as graduation, just with no persisted flag afterward.
    this.onFoodFightAnnounce = null; // (peerId, name) => void
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
      this.peers.set(m.id, { x: m.x, y: m.y, dir: m.dir, moving: m.moving, name: m.name, club: m.club || null, running: !!m.running, dancing: !!m.dancing, performing: !!m.performing, project: m.project || null, graduated: !!m.graduated, last: performance.now() });
    } else if (m.t === "chat" && this.onChat) {
      this.onChat(m.id, m.name, m.text);
    } else if (m.t === "emote" && this.onEmote) {
      this.onEmote(m.id, m.name, m.emoji);
    } else if (m.t === "trade-offer" && this.onTradeOffer) {
      if (m.to !== this.id) return;
      this.onTradeOffer(m.id, m.name, m.cards);
    } else if (m.t === "trade-accept" && this.onTradeAccept) {
      if (m.to !== this.id) return;
      this.onTradeAccept(m.id, m.name, m.cards);
    } else if (m.t === "trade-decline" && this.onTradeDecline) {
      if (m.to !== this.id) return;
      this.onTradeDecline(m.id, m.name);
    } else if (m.t === "gift" && this.onGift) {
      if (m.to !== this.id) return;
      this.onGift(m.id, m.name, m.cardId);
    } else if (m.t === "vote" && this.onVote) {
      this.onVote(m.id, m.name, m.for);
    } else if (m.t === "graduate" && this.onGraduationAnnounce) {
      this.onGraduationAnnounce(m.id, m.name);
    } else if (m.t === "food-fight" && this.onFoodFightAnnounce) {
      this.onFoodFightAnnounce(m.id, m.name);
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
      t: "pos", id: this.id, name: this.name, club: this.club, running: this.running, dancing: this.dancing, performing: this.performing, project: this.project, graduated: this.graduated,
      x: Math.round(player.x), y: Math.round(player.y),
      dir: player.dir, moving: player.moving,
    });
  }

  setClub(name) { this.club = name || null; }
  setRunning(v) { this.running = !!v; }
  setDancing(v) { this.dancing = !!v; }
  setPerforming(v) { this.performing = !!v; }
  setProject(name) { this.project = name || null; }
  setGraduated(v) { this.graduated = !!v; }
  sendGraduationAnnounce() {
    if (!this.connected) return;
    this.transport.send({ t: "graduate", id: this.id, name: this.name });
  }
  sendFoodFightAnnounce() {
    if (!this.connected) return;
    this.transport.send({ t: "food-fight", id: this.id, name: this.name });
  }
  sendVote(forId) {
    if (!this.connected) return;
    this.transport.send({ t: "vote", id: this.id, name: this.name, for: forId });
  }

  sendChat(text) {
    if (!this.connected) return;
    this.transport.send({ t: "chat", id: this.id, name: this.name, text });
  }

  sendEmote(emoji) {
    if (!this.connected) return;
    this.transport.send({ t: "emote", id: this.id, name: this.name, emoji });
  }

  sendTradeOffer(toId, cards) {
    if (!this.connected) return;
    this.transport.send({ t: "trade-offer", id: this.id, name: this.name, to: toId, cards });
  }
  sendTradeAccept(toId, cards) {
    if (!this.connected) return;
    this.transport.send({ t: "trade-accept", id: this.id, name: this.name, to: toId, cards });
  }
  sendTradeDecline(toId) {
    if (!this.connected) return;
    this.transport.send({ t: "trade-decline", id: this.id, name: this.name, to: toId });
  }
  sendGift(toId, cardId) {
    if (!this.connected) return;
    this.transport.send({ t: "gift", id: this.id, name: this.name, to: toId, cardId });
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

/* Trollrreria — co-op networking (v1: shared-world sync).
   What syncs: world layers on join (exact RLE snapshot), live tile/wall/
   wire edits, chest contents, host clock/flags, player ghosts, and
   announcements. What stays local: enemies, drops, liquids settling and
   bosses — every player fights their own monsters (documented).

   Transports:
     - Supabase Realtime broadcast (internet) when the CDN client loads
     - BroadcastChannel (tabs in the same browser) as automatic fallback */

import { TILE } from "./defs.js";

const SUPABASE_URL = "https://tjsyhfplxjtakdfkpdtg.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqc3loZnBseGp0YWtkZmtwZHRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzOTc0ODksImV4cCI6MjA5MTk3MzQ4OX0.xLUcPUUguRBQttNwiIRWJHxjJjLqrQDMu4Ubsk5yZoQ";

/* ------------------------------------------------------------ transports */
class BroadcastTransport {
  constructor() { this.kind = "tabs"; }
  connect(room, onMsg) {
    this.ch = new BroadcastChannel("trollrreria:" + room);
    this.ch.onmessage = e => onMsg(e.data);
    return Promise.resolve(true);
  }
  send(msg) { try { this.ch && this.ch.postMessage(msg); } catch (e) { /* payload too big etc. */ } }
  close() { this.ch && this.ch.close(); this.ch = null; }
}

class SupabaseTransport {
  constructor() { this.kind = "online"; }
  connect(room, onMsg) {
    return new Promise(resolve => {
      try {
        if (!window.supabase || !window.supabase.createClient) return resolve(false);
        this.client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: { persistSession: false },
          realtime: { params: { eventsPerSecond: 24 } },
        });
        this.chan = this.client.channel("trollrreria:" + room, {
          config: { broadcast: { self: false } },
        });
        this.chan.on("broadcast", { event: "tt" }, p => onMsg(p.payload));
        const timeout = setTimeout(() => resolve(false), 6000);
        this.chan.subscribe(status => {
          if (status === "SUBSCRIBED") { clearTimeout(timeout); resolve(true); }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { clearTimeout(timeout); resolve(false); }
        });
      } catch (e) { resolve(false); }
    });
  }
  send(msg) {
    try { this.chan && this.chan.send({ type: "broadcast", event: "tt", payload: msg }); }
    catch (e) { /* non-fatal */ }
  }
  close() {
    try { this.chan && this.client.removeChannel(this.chan); } catch (e) { /* ignore */ }
    this.chan = null;
  }
}

/* Soft cap for a shared room: this is P2P broadcast through Supabase
   Realtime, not an authoritative server, so the host's browser is doing
   the simulating -- past ~20 concurrent players the host's tab is the
   bottleneck (world-sync chunking + edit fan-out), not the transport. */
const MAX_PEERS = 20;

/* ------------------------------------------------------------------- net */
export class Net {
  constructor(game) {
    this.game = game;
    this.transport = null;
    this.room = null;
    this.isHost = false;
    this.connected = false;
    this.applying = false;        // true while applying a remote edit
    this.id = Math.random().toString(36).slice(2, 10);
    this.peers = new Map();       // id -> { x, y, dir, anim, name, last }
    this._posAcc = 0;
    this._timeAcc = 0;
  }

  get active() { return this.connected; }
  get peerCount() { return this.peers.size; }

  makeCode() {
    const abc = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
    let s = "";
    for (let i = 0; i < 5; i++) s += abc[Math.floor(Math.random() * abc.length)];
    return s;
  }

  async start(room, asHost) {
    this.stop();
    this.room = room.toUpperCase();
    this.isHost = asHost;
    const onMsg = m => this.onMessage(m);
    /* try the internet first, fall back to same-browser tabs */
    let t = new SupabaseTransport();
    let ok = await t.connect(this.room, onMsg);
    if (!ok) {
      t = new BroadcastTransport();
      ok = await t.connect(this.room, onMsg);
    }
    if (!ok) return false;
    this.transport = t;
    this.connected = true;
    this.hookWorld();
    if (!asHost) this.send({ t: "hello", id: this.id });
    this.game.announce(asHost
      ? `🌐 Hosting room ${this.room} (${t.kind})`
      : `🌐 Joined room ${this.room} (${t.kind}) — syncing…`);
    return true;
  }

  stop() {
    if (this.transport) {
      this.send({ t: "bye", id: this.id });
      this.transport.close();
    }
    this.transport = null;
    this.connected = false;
    this.peers.clear();
    if (this.game.world) this.game.world.onEdit = null;
  }

  send(msg) {
    if (this.transport) this.transport.send(msg);
  }

  /* Broadcast local world edits (attached to the live world instance). */
  hookWorld() {
    this.game.world.onEdit = (kind, x, y, v) => {
      if (this.applying) return;
      this.send({ t: "edit", k: kind, x, y, v, id: this.id });
    };
  }

  /* ------------------------------------------------------- rx handling */
  onMessage(m) {
    if (!m || m.id === this.id) return;
    const g = this.game;
    if (m.id) {
      const peer = this.peers.get(m.id) || { name: "troll" };
      peer.last = performance.now();
      this.peers.set(m.id, peer);
    }
    switch (m.t) {
      case "hello":
        if (this.isHost) {
          if (this.peers.size > MAX_PEERS) {
            this.peers.delete(m.id);
            this.send({ t: "full", id: this.id, to: m.id });
            break;
          }
          this.sendWorld();
        }
        this.send({ t: "here", id: this.id });   // so newcomers see us too
        break;
      case "here":
        break;                                   // presence already recorded above
      case "full":
        if (m.to === this.id) {
          this.game.announce("🌐 That room is full (20 players) — try another code.");
          this.stop();
        }
        break;
      case "world": {
        if (this.isHost) break;
        g.adoptRemoteWorld(m);
        break;
      }
      case "wchunk": {
        if (this.isHost) break;
        if (!this._wbuf || this._wbuf.from !== m.id || this._wbuf.total !== m.total) {
          this._wbuf = { from: m.id, total: m.total, parts: new Array(m.total).fill(null), got: 0 };
        }
        if (this._wbuf.parts[m.seq] === null) {
          this._wbuf.parts[m.seq] = m.data;
          this._wbuf.got++;
        }
        if (this._wbuf.got === this._wbuf.total) {
          try {
            const world = JSON.parse(this._wbuf.parts.join(""));
            this._wbuf = null;
            g.adoptRemoteWorld(world);
          } catch (e) {
            this._wbuf = null;
            this.send({ t: "hello", id: this.id });   // ask again
          }
        }
        break;
      }
      case "edit": {
        const w = g.world;
        this.applying = true;
        if (m.k === "tile") w.set(m.x, m.y, m.v);
        else if (m.k === "wall") w.setWall(m.x, m.y, m.v);
        else if (m.k === "wire") w.setWire(m.x, m.y, m.v);
        this.applying = false;
        break;
      }
      case "chest": {
        g.world.chests.set(m.key, { items: m.items });
        if (g.ui && g.ui.chest && g.ui.chest.key === m.key) g.ui.paintChest();
        break;
      }
      case "pos": {
        const peer = this.peers.get(m.id);
        Object.assign(peer, { x: m.x, y: m.y, dir: m.dir, anim: m.anim, name: m.name });
        break;
      }
      case "time": {
        if (this.isHost) break;
        g.time = m.time;
        g.dayCount = m.day;
        g.trollMoon = !!m.moon;
        g.pvp = !!m.pvp;
        if (m.hard && !g.flags.hardmode) g.enterHardmode();
        break;
      }
      case "pvpHit": {
        /* trust-based like everything else on the mesh: the target applies
           the hit to itself, and only while it also believes PvP is on */
        if (m.target !== this.id) break;
        if (!g.pvp || !g.player || g.player.dead) break;
        g.player.hurt(g, m.dmg, "another troll", m.fromX);
        break;
      }
      case "note":
        g.announce(m.text);
        break;
      case "bye":
        this.peers.delete(m.id);
        break;
    }
  }

  /* Host: ship the exact world (save-style packed layers). Realtime
     broadcasts cap out around 250 KB, so big worlds go out in paced
     ~24 KB chunks that the guest reassembles. */
  sendWorld() {
    const g = this.game;
    const msg = {
      t: "world",
      seedStr: g.seedStr,
      w: g.world.w, h: g.world.h,
      time: g.time, day: g.dayCount, moon: g.trollMoon,
      flags: g.flags,
      spawn: g.spawn,
      layers: g.packLayersForNet(),
      chests: [...g.world.chests.entries()].map(([k, c]) => [k, c.items]),
    };
    const raw = JSON.stringify(msg);
    if (this.transport.kind !== "online" && raw.length < 4_000_000) {
      this.send(msg);                       // BroadcastChannel: one shot
      return;
    }
    const CH = 24000;
    const total = Math.ceil(raw.length / CH);
    let seq = 0;
    const pump = () => {
      if (!this.connected || seq >= total) return;
      this.send({ t: "wchunk", id: this.id, seq, total, data: raw.slice(seq * CH, (seq + 1) * CH) });
      seq++;
      setTimeout(pump, 130);                // stay under realtime rate limits
    };
    pump();
  }

  /* --------------------------------------------------------- per frame */
  update(dt) {
    if (!this.connected) return;
    const g = this.game;
    this._posAcc += dt;
    if (this._posAcc >= 0.2 && g.player && !g.player.dead) {
      this._posAcc = 0;
      this.send({
        t: "pos", id: this.id,
        x: Math.round(g.player.x), y: Math.round(g.player.y),
        dir: g.player.dir, anim: g.player.anim,
        name: this.isHost ? "host troll" : "troll",
      });
    }
    if (this.isHost) {
      this._timeAcc += dt;
      if (this._timeAcc >= 5) {
        this._timeAcc = 0;
        this.send({
          t: "time", id: this.id, time: g.time, day: g.dayCount,
          moon: g.trollMoon, hard: !!g.flags.hardmode, pvp: !!g.pvp,
        });
      }
    }
    /* expire silent ghosts */
    const now = performance.now();
    for (const [id, p] of this.peers) {
      if (now - p.last > 6000) this.peers.delete(id);
    }
  }

  /* Ghost players: tinted rig frames + a name tag. */
  drawPeers(ctx) {
    const g = this.game;
    const rig = g.player && g.player.rig;
    for (const p of this.peers.values()) {
      if (p.x === undefined) continue;
      const feetX = p.x + 11, feetY = p.y + 44;
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.filter = "hue-rotate(175deg) saturate(1.2)";
      const a = rig && rig[p.anim === "walk" ? "walk" : p.anim === "jump" ? "jump" : "idle"];
      if (a && g.player.rigBox) {
        const b = g.player.rigBox;
        const scale = 58 / b.h;
        const fi = Math.floor(performance.now() / 1000 * a.fps) % a.frames;
        ctx.translate(feetX, feetY);
        if (p.dir < 0) ctx.scale(-1, 1);
        ctx.drawImage(a.img, fi * 136 + b.x, b.y, b.w, b.h, -(b.w * scale) / 2, -58, b.w * scale, 58);
      } else {
        ctx.fillStyle = "#7cc4ff";
        ctx.fillRect(p.x, p.y, 22, 44);
      }
      ctx.restore();
      ctx.font = "bold 8px 'DM Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(124,196,255,0.95)";
      ctx.fillText(p.name || "troll", feetX, p.y - 6);
      ctx.textAlign = "left";
    }
  }
}

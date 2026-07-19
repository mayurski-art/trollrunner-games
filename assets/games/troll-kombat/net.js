/* Troll Kombat — online multiplayer session (invite-code lobby + transport).
   Modeled on Trollrreria's net.js: Supabase Realtime broadcast when the CDN
   client is available, BroadcastChannel (same-browser tabs) as the fallback.

   This file owns the SESSION: codes, handshake, liveness, raw send/receive.
   game.js owns the MEANING: it registers handlers for typed messages and
   decides what a pick / input / snapshot / event does. Rooms are exactly two
   players — the creator is the host (P1 + the authoritative simulation), the
   joiner is the guest (P2, inputs up / state down).

   Design doc: docs/TROLL-KOMBAT-ONLINE.md */
(() => {
  "use strict";

  const SUPABASE_URL = "https://tjsyhfplxjtakdfkpdtg.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqc3loZnBseGp0YWtkZmtwZHRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzOTc0ODksImV4cCI6MjA5MTk3MzQ4OX0.xLUcPUUguRBQttNwiIRWJHxjJjLqrQDMu4Ubsk5yZoQ";

  const HELLO_TIMEOUT = 8000;   // ms a joiner waits for the host's welcome
  const PEER_TIMEOUT = 5000;    // ms of radio silence before "connection lost"
  const PING_EVERY = 1000;      // ms heartbeat when nothing else is being sent

  /* ------------------------------------------------------------ transports */
  class BroadcastTransport {
    constructor() { this.kind = "tabs"; }
    connect(room, onMsg) {
      this.ch = new BroadcastChannel("kombat:" + room);
      this.ch.onmessage = e => onMsg(e.data);
      return Promise.resolve(true);
    }
    send(msg) { try { this.ch && this.ch.postMessage(msg); } catch (e) { /* ignore */ } }
    close() { this.ch && this.ch.close(); this.ch = null; }
  }

  class SupabaseTransport {
    constructor() { this.kind = "online"; }
    connect(room, onMsg) {
      return new Promise(resolve => {
        try {
          if (!window.supabase || !window.supabase.createClient) return resolve(false);
          // Own client, isolated from the accounts client (no shared auth state).
          this.client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: { persistSession: false },
            realtime: { params: { eventsPerSecond: 32 } },
          });
          this.chan = this.client.channel("kombat:" + room, {
            config: { broadcast: { self: false } },
          });
          this.chan.on("broadcast", { event: "tk" }, p => onMsg(p.payload));
          const timeout = setTimeout(() => resolve(false), 6000);
          this.chan.subscribe(status => {
            if (status === "SUBSCRIBED") { clearTimeout(timeout); resolve(true); }
            if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { clearTimeout(timeout); resolve(false); }
          });
        } catch (e) { resolve(false); }
      });
    }
    send(msg) {
      try { this.chan && this.chan.send({ type: "broadcast", event: "tk", payload: msg }); }
      catch (e) { /* non-fatal */ }
    }
    close() {
      try { this.chan && this.client.removeChannel(this.chan); } catch (e) { /* ignore */ }
      this.chan = null;
    }
  }

  /* ---------------------------------------------------------------- session */
  const net = {
    transport: null,
    role: null,           // "host" | "guest" | null
    code: null,
    paired: false,        // handshake completed, opponent live
    id: Math.random().toString(36).slice(2, 10),
    peerId: null,
    lastRx: 0,            // performance.now() of the last peer message
    lastTx: 0,
    handlers: {},         // {paired, peerLeft, message(t, msg)}
    _joinWait: null,      // pending join resolve fn

    get active() { return !!this.transport; },
    get isHost() { return this.paired && this.role === "host"; },
    get isGuest() { return this.paired && this.role === "guest"; },

    makeCode() {
      const abc = "ABCDEFGHJKMNPQRSTVWXYZ23456789";   // no confusables (I/L/O/0/1)
      let s = "";
      for (let i = 0; i < 5; i++) s += abc[Math.floor(Math.random() * abc.length)];
      return s;
    },

    on(handlers) { Object.assign(this.handlers, handlers); },

    async _connect(room) {
      const onMsg = m => this._onMessage(m);
      let t = new SupabaseTransport();
      let ok = await t.connect(room, onMsg);
      if (!ok) {
        t = new BroadcastTransport();
        ok = await t.connect(room, onMsg);
      }
      if (!ok) return null;
      return t;
    },

    /* Host: open the room and wait for a hello. Resolves with the transport
       kind once listening (pairing happens later, via the "paired" handler). */
    async host(code) {
      this.leave(true);
      const t = await this._connect(code);
      if (!t) return null;
      this.transport = t;
      this.role = "host";
      this.code = code;
      return t.kind;
    },

    /* Guest: join a room and shake hands. Resolves "ok" | "full" | "timeout" | "offline". */
    async join(code) {
      this.leave(true);
      const t = await this._connect(code);
      if (!t) return "offline";
      this.transport = t;
      this.role = "guest";
      this.code = code;
      return new Promise(resolve => {
        const timer = setTimeout(() => {
          this._joinWait = null;
          this.leave(true);
          resolve("timeout");
        }, HELLO_TIMEOUT);
        this._joinWait = result => {
          clearTimeout(timer);
          this._joinWait = null;
          if (result !== "ok") this.leave(true);
          resolve(result);
        };
        this.send("hello", {});
      });
    },

    /* Leave the room. quiet=true skips the goodbye (already gone / cleanup). */
    leave(quiet) {
      if (this.transport && !quiet) this.send("bye", {});
      if (this.transport) this.transport.close();
      this.transport = null;
      this.role = null;
      this.code = null;
      this.paired = false;
      this.peerId = null;
      this._joinWait = null;
    },

    send(t, payload) {
      if (!this.transport) return;
      this.lastTx = performance.now();
      // Envelope fields go LAST so a payload key can never clobber them —
      // e.g. a fighter-pick payload legitimately has its own `id` field.
      this.transport.send(Object.assign({}, payload, { t, _from: this.id }));
    },

    _onMessage(m) {
      if (!m || m._from === this.id) return;
      if (m.to && m.to !== this.id) return;   // addressed to someone else
      this.lastRx = performance.now();

      switch (m.t) {
        case "hello":
          if (this.role !== "host") return;
          if (this.paired && this.peerId !== m._from) {
            this.send("full", { to: m._from });
            return;
          }
          this.peerId = m._from;
          if (!this.paired) {
            this.paired = true;
            this.send("welcome", { to: m._from });
            this.handlers.paired && this.handlers.paired();
          }
          return;
        case "welcome":
          if (this.role !== "guest" || this.paired) return;
          this.peerId = m._from;
          this.paired = true;
          this._joinWait && this._joinWait("ok");
          this.handlers.paired && this.handlers.paired();
          return;
        case "full":
          this._joinWait && this._joinWait("full");
          return;
        case "ping":
          return;                              // lastRx already refreshed
        case "bye":
          if (m._from !== this.peerId) return;
          this._peerGone("left");
          return;
        default:
          if (this.paired && m._from === this.peerId && this.handlers.message) {
            this.handlers.message(m.t, m);
          }
      }
    },

    _peerGone(why) {
      if (!this.paired) return;
      this.paired = false;
      this.peerId = null;
      this.handlers.peerLeft && this.handlers.peerLeft(why);
    },

    /* Called every frame from the game loop: heartbeat + liveness. */
    tick() {
      if (!this.transport) return;
      const now = performance.now();
      if (now - this.lastTx > PING_EVERY) this.send("ping", {});
      if (this.paired && now - this.lastRx > PEER_TIMEOUT) this._peerGone("timeout");
    },
  };

  window.addEventListener("beforeunload", () => net.leave(false));
  window.KombatNet = net;
})();

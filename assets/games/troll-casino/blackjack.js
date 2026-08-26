/* ============================================================================
   TROLL CASINO  —  Pepe's Diamond Hands Blackjack  (room module)

   Pepe deals a real blackjack game: hit / stand / double / split (once) /
   insurance, dealer hits soft 17, blackjack pays 3:2, six-deck shoe with a
   crypto-RNG shuffle. All money moves through TrollCasinoWallet; results
   report through TrollCasino.reportRound like every other room.

   HOUSE RULES (shown on the felt)
   - Blackjack pays 3:2 · Dealer hits soft 17 · Insurance pays 2:1
   - Double on any first two cards (incl. after split, except split aces)
   - One split; split aces get one card each

   The rules engine sits between the MODEL markers (pure, node-testable);
   everything below it is presentation + table flow.
   ============================================================================ */
(() => {
  "use strict";

  /* ==========================================================================
     BLACKJACK MODEL  (pure — keep DOM out of this block)
     ========================================================================== */
  /* MODEL:BEGIN */
  const BJ_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const BJ_SUITS = ["♠", "♥", "♦", "♣"];

  function cardValue(rank) {
    if (rank === "A") return 11;
    if (rank === "J" || rank === "Q" || rank === "K") return 10;
    return Number(rank);
  }

  function rand01() {
    const c = (typeof globalThis !== "undefined" && globalThis.crypto) || null;
    if (c && c.getRandomValues) {
      const b = new Uint32Array(1);
      c.getRandomValues(b);
      return b[0] / 4294967296;
    }
    return Math.random();
  }

  function buildShoe(decks = 6) {
    const shoe = [];
    for (let d = 0; d < decks; d++)
      for (const s of BJ_SUITS)
        for (const r of BJ_RANKS) shoe.push({ rank: r, suit: s });
    for (let i = shoe.length - 1; i > 0; i--) {           // Fisher–Yates
      const j = Math.floor(rand01() * (i + 1));
      [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
    }
    return shoe;
  }

  // → { total, soft }  (aces downgrade 11→1 as needed; soft = an ace still 11)
  function handValue(cards) {
    let total = 0, aces = 0;
    for (const c of cards) { total += cardValue(c.rank); if (c.rank === "A") aces++; }
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    return { total, soft: aces > 0 };
  }

  const isBlackjack = (cards) => cards.length === 2 && handValue(cards).total === 21;
  const isBust = (cards) => handValue(cards).total > 21;
  const canSplit = (cards) => cards.length === 2 && cardValue(cards[0].rank) === cardValue(cards[1].rank);
  const dealerShouldHit = (cards) => {
    const v = handValue(cards);
    return v.total < 17 || (v.total === 17 && v.soft);   // H17
  };

  // One player hand vs the finished dealer hand → credited multiple of the bet.
  // 2.5 = natural blackjack (3:2), 2 = win, 1 = push, 0 = loss.
  function settleHand(player, dealer, { playerIsBJ = false, dealerIsBJ = false } = {}) {
    if (playerIsBJ && dealerIsBJ) return { result: "push", mult: 1 };
    if (playerIsBJ) return { result: "blackjack", mult: 2.5 };
    if (dealerIsBJ) return { result: "lose", mult: 0 };
    const p = handValue(player).total, d = handValue(dealer).total;
    if (p > 21) return { result: "bust", mult: 0 };
    if (d > 21) return { result: "win", mult: 2 };
    if (p > d) return { result: "win", mult: 2 };
    if (p < d) return { result: "lose", mult: 0 };
    return { result: "push", mult: 1 };
  }
  /* MODEL:END */

  /* ==========================================================================
     TABLE FLOW + PRESENTATION
     ========================================================================== */
  const $ = (sel) => document.querySelector(sel);
  const wallet = () => window.TrollCasinoWallet;
  const audio = () => window.TrollCasino.audio;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pace = (ms) => (REDUCED ? 40 : ms);

  const PEPE = {
    idle: "Sit. Cards don't lie — mostly.",
    deal: "Fresh cards. Diamond hands only.",
    insurance: "Pepe shows an ace. Feeling nervous?",
    win: "Ribbit. Nicely played.",
    blackjack: "💎 Diamond hands. Pays 3 to 2.",
    bust: "The pond takes it. Problem?",
    lose: "Pepe stays smug for a reason.",
    push: "We meet again.",
    dealerBust: "Pepe overcooked it. Take the chips.",
  };

  const T = {
    shoe: [],
    phase: "betting",       // betting | insurance | player | dealer | settled
    bet: 0,
    hands: [],              // [{ cards, bet, doubled, done, fromSplit }]
    active: 0,
    dealer: [],
    holeHidden: true,
    insurance: 0,
    fx: null,
    recent: [],
  };

  function ensureShoe() {
    if (T.shoe.length < 60) T.shoe = buildShoe(6);
  }
  const draw = () => T.shoe.pop();

  /* --- room registration ------------------------------------------------------ */
  window.TrollCasino.registerGame({
    id: "blackjack", room: "room-blackjack",
    name: "Diamond Hands Blackjack", emoji: "🐸", color: "#3dff8a",
    host: "Hosted by Pepe", tagline: "Hit, stand, split, double. Pepe hits soft 17 and never blinks.",
    cta: "Sit at the table",
    art: "assets/games/troll-casino/art/pepe-blackjack-hero.webp",
    onEnter: () => setLine(PEPE.idle),
  });

  /* --- markup ------------------------------------------------------------------ */
  function buildRoom() {
    const room = document.getElementById("room-blackjack");
    if (!room) return;
    room.innerHTML = `
      <div class="room-hero">
        <div class="rh-art" data-art="assets/games/troll-casino/art/pepe-blackjack-hero.webp"></div>
        <div class="rh-body">
          <span class="rh-kicker">Pepe presents</span>
          <h2>Diamond Hands Blackjack</h2>
          <p>A slick frog, a six-deck shoe, and a felt that pays 3:2. Dealer hits soft 17 — Pepe likes the action.</p>
          <button type="button" class="rh-enter" data-act="sit">🐸 Sit Down</button>
        </div>
      </div>
      <div class="room-play">
        <div class="room-panel">
          <div class="room-title">
            <h2>💎 Pepe's Diamond Hands Blackjack</h2>
            <span class="table-tag" id="bj-shoe-tag">shoe: — cards</span>
          </div>
          <div class="host-line" style="--hl:#3dff8a">
            <span class="host-face">🐸</span>
            <q id="bj-line">${PEPE.idle}</q>
          </div>

          <div class="bj-table">
            <div class="bj-side">
              <span class="bj-side-label">Pepe deals</span>
              <div class="bj-hand" id="bj-dealer">
                <div class="bj-cards"></div>
                <span class="bj-total">—</span>
              </div>
            </div>
            <div class="bj-felt">Blackjack pays 3 to 2 · Dealer hits soft 17 · Insurance pays 2 to 1</div>
            <div class="bj-side">
              <span class="bj-side-label">Your hands</span>
              <div class="bj-hands" id="bj-hands"></div>
            </div>
          </div>

          <div class="bj-actions" id="bj-bet-row">
            <div class="chip-rack" id="bj-chips"></div>
            <button type="button" class="ghost-btn" data-act="clear">Clear</button>
            <p class="total-staked" id="bj-status">Bet: <strong>0</strong></p>
            <button type="button" class="bj-btn is-primary" data-act="deal">DEAL</button>
          </div>

          <div class="bj-actions" id="bj-play-row" hidden>
            <button type="button" class="bj-btn" data-act="hit">Hit</button>
            <button type="button" class="bj-btn" data-act="stand">Stand</button>
            <button type="button" class="bj-btn" data-act="double">Double</button>
            <button type="button" class="bj-btn" data-act="split">Split</button>
            <button type="button" class="bj-btn" data-act="insurance">Insurance</button>
            <button type="button" class="bj-btn" data-act="no-insurance" hidden>No thanks</button>
          </div>

          <div class="cr-history" id="bj-recent"><span class="crh-empty">No hands yet</span></div>
          <div class="result-banner" id="bj-banner" role="status" aria-live="assertive"></div>
          <canvas id="bj-fx" aria-hidden="true" style="position:absolute;inset:0;pointer-events:none"></canvas>
        </div>
      </div>`;

    // hero art probe (gradient stays if missing)
    const art = room.querySelector(".rh-art");
    const probe = new Image();
    probe.onload = () => { art.style.backgroundImage = `url("${art.dataset.art}")`; art.classList.add("has-art"); };
    probe.src = art.dataset.art;

    T.fx = window.TrollCasino.makeFX(room.querySelector("#bj-fx"));
    buildChips();
    room.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act]");
      if (btn && !btn.disabled) act(btn.dataset.act, btn);
    });
    wallet().onChange(() => { if (T.phase === "betting") renderBetUI(); });
  }

  function buildChips() {
    const cur = wallet().list().find(c => c.code === wallet().getCurrency());
    $("#bj-chips").innerHTML = cur.chips.map(v => `
      <button type="button" class="chip-btn" style="--chip:${cur.color}" data-act="chip" data-value="${v}"
              aria-label="Add ${v} ${cur.label} to bet">${v >= 1000 ? v / 1000 + "K" : v}</button>`).join("");
  }

  /* --- actions ----------------------------------------------------------------- */
  function act(action, btn) {
    if (action === "chip") { addChip(Number(btn.dataset.value)); return; }
    const fns = {
      sit: () => { document.getElementById("room-blackjack").classList.add("is-playing"); resetTable(); },
      clear: () => { if (T.phase === "betting") { T.bet = 0; renderBetUI(); } },
      deal, hit, stand, double: doubleDown, split, insurance: takeInsurance, "no-insurance": declineInsurance,
    };
    fns[action]?.();
  }

  function addChip(v) {
    if (T.phase !== "betting") return;
    if (!wallet().canAfford(T.bet + v)) { setLine("Not enough chips for that. Pepe suggests adding funds."); return; }
    T.bet += v;
    audio().ensure(); audio().chip();
    renderBetUI();
  }

  async function deal() {
    if (T.phase !== "betting" || T.bet <= 0) { if (T.bet <= 0) setLine("Chips first. Then cards."); return; }
    if (!wallet().debit(T.bet, "Blackjack bet")) { setLine("Balance won't cover that bet anymore."); return; }
    ensureShoe();
    audio().ensure();

    T.phase = "dealing";
    T.hands = [{ cards: [], bet: T.bet, doubled: false, done: false, fromSplit: false }];
    T.active = 0;
    T.dealer = [];
    T.holeHidden = true;
    T.insurance = 0;
    hideBanner();
    setLine(PEPE.deal);
    $("#bj-bet-row").hidden = true;
    $("#bj-play-row").hidden = false;
    renderTable();
    renderControls();   // everything disabled while the cards fly

    // classic deal order: player, dealer up, player, dealer hole
    for (const target of [T.hands[0].cards, T.dealer, T.hands[0].cards, T.dealer]) {
      target.push(draw());
      audio().chip();
      renderTable();
      await sleep(pace(340));
    }

    if (T.dealer[0].rank === "A") {
      T.phase = "insurance";
      setLine(PEPE.insurance);
      renderControls();
      return;
    }
    afterInsurance();
  }

  function takeInsurance() {
    if (T.phase !== "insurance") return;
    const cost = Math.floor(T.hands[0].bet / 2) || 1;
    if (!wallet().debit(cost, "Blackjack insurance")) { setLine("Can't cover insurance — playing on."); afterInsurance(); return; }
    T.insurance = cost;
    afterInsurance();
  }
  function declineInsurance() { if (T.phase === "insurance") afterInsurance(); }

  function afterInsurance() {
    if (isBlackjack(T.dealer)) {
      if (T.insurance) wallet().credit(T.insurance * 3, "Insurance pays 2:1");
      return finishRound();   // dealer BJ ends the hand immediately
    }
    if (T.insurance) setLine("No troll under the hood. Insurance stays with Pepe.");
    T.phase = "player";
    if (isBlackjack(T.hands[0].cards)) return finishRound();   // player natural
    renderAll();
  }

  async function hit() {
    if (T.phase !== "player") return;
    const hand = T.hands[T.active];
    hand.cards.push(draw());
    audio().chip();
    renderTable();
    if (isBust(hand.cards) || handValue(hand.cards).total === 21) { hand.done = true; await nextHand(); }
    else renderControls();
  }

  async function stand() {
    if (T.phase !== "player") return;
    T.hands[T.active].done = true;
    await nextHand();
  }

  async function doubleDown() {
    if (T.phase !== "player") return;
    const hand = T.hands[T.active];
    if (hand.cards.length !== 2 || !wallet().debit(hand.bet, "Blackjack double")) return;
    hand.bet *= 2;
    hand.doubled = true;
    hand.cards.push(draw());
    hand.done = true;
    audio().chip();
    renderTable();
    await nextHand();
  }

  async function split() {
    if (T.phase !== "player" || T.hands.length > 1) return;
    const hand = T.hands[0];
    if (!canSplit(hand.cards) || !wallet().debit(hand.bet, "Blackjack split")) return;
    const aces = hand.cards[0].rank === "A";
    T.hands = [
      { cards: [hand.cards[0], draw()], bet: hand.bet, doubled: false, done: aces, fromSplit: true },
      { cards: [hand.cards[1], draw()], bet: hand.bet, doubled: false, done: aces, fromSplit: true },
    ];
    T.active = 0;
    audio().chip();
    renderTable();
    if (aces) { setLine("Split aces get one card each. House rules."); await nextHand(); }
    else renderControls();
  }

  async function nextHand() {
    renderTable();
    const idx = T.hands.findIndex(h => !h.done);   // bust/double/split-ace hands are marked done
    if (idx !== -1) { T.active = idx; renderAll(); return; }
    if (T.hands.every(h => isBust(h.cards))) return finishRound();   // nothing left to beat
    await dealerPlay();
  }

  async function dealerPlay() {
    T.phase = "dealer";
    renderControls();
    T.holeHidden = false;
    audio().chip();
    renderTable();
    await sleep(pace(600));
    while (dealerShouldHit(T.dealer)) {
      T.dealer.push(draw());
      audio().chip();
      renderTable();
      await sleep(pace(560));
    }
    finishRound();
  }

  /* --- settlement ---------------------------------------------------------------- */
  function finishRound() {
    T.phase = "settled";
    T.holeHidden = false;
    const dealerBJ = isBlackjack(T.dealer);
    const dealerV = handValue(T.dealer);

    let credited = 0, staked = 0, best = { result: "lose", mult: 0 };
    const order = { blackjack: 4, win: 3, push: 2, lose: 1, bust: 0 };
    for (const hand of T.hands) {
      const s = settleHand(hand.cards, T.dealer, {
        playerIsBJ: !hand.fromSplit && isBlackjack(hand.cards),
        dealerIsBJ: dealerBJ,
      });
      hand.settled = s;
      staked += hand.bet;
      const pay = Math.round(hand.bet * s.mult * 100) / 100;
      if (pay > 0) { wallet().credit(pay, `Blackjack ${s.result}`); credited += pay; }
      if (order[s.result] > order[best.result]) best = s;
    }

    // presentation
    renderTable();
    const won = credited > staked;
    const zone = { blackjack: "#ffc94d", win: "#3dff8a", push: "#3ea8ff", lose: "#ff3358", bust: "#ff3358" }[best.result];
    showBanner(best.result, credited, staked, zone);
    setLine(
      best.result === "blackjack" ? PEPE.blackjack :
      best.result === "bust" ? PEPE.bust :
      dealerV.total > 21 ? PEPE.dealerBust :
      best.result === "win" ? PEPE.win :
      best.result === "push" ? PEPE.push : PEPE.lose);
    if (best.result === "blackjack") { audio().whale(); T.fx.burst(["#ffc94d", "#3dff8a", "#fff"], 70); }
    else if (won) { audio().win(); T.fx.burst(["#3dff8a", "#ffc94d"]); }
    else if (credited === staked && staked > 0) audio().chip();
    else audio().rug();

    pushRecent(best.result);
    window.TrollCasino.reportRound("blackjack", {
      won, mult: staked ? Math.round((credited / staked) * 10) / 10 : 0,
      meta: { result: best.result, hands: T.hands.length, staked, payout: credited },
    });

    // back to betting (same bet pre-loaded for a quick rematch feel)
    setTimeout(() => { if (T.phase === "settled") resetTable(true); }, pace(2600));
  }

  function resetTable(keepBet) {
    T.phase = "betting";
    if (!keepBet) T.bet = 0;
    T.hands = []; T.dealer = []; T.insurance = 0; T.holeHidden = true;
    ensureShoe();
    buildChips();          // currency may have changed while away
    renderAll();
    $("#bj-bet-row").hidden = false;
    $("#bj-play-row").hidden = true;
  }

  /* --- rendering ------------------------------------------------------------------ */
  function cardEl(card, down) {
    const red = card.suit === "♥" || card.suit === "♦";
    return `<div class="pcard${red ? " is-red" : ""}${down ? " is-down" : ""}">
      <span class="pc-rank">${card.rank}</span><span class="pc-suit">${card.suit}</span></div>`;
  }

  function totalLabel(cards, hideHole) {
    if (!cards.length) return "—";
    if (hideHole) return cardValue(cards[0].rank) + " + ?";
    const v = handValue(cards);
    return v.total > 21 ? v.total + " · BUST" : (v.soft && v.total !== 21 ? (v.total - 10) + " / " + v.total : String(v.total));
  }

  function renderTable() {
    const dealer = $("#bj-dealer");
    dealer.querySelector(".bj-cards").innerHTML =
      T.dealer.map((c, i) => cardEl(c, T.holeHidden && i === 1)).join("");
    dealer.querySelector(".bj-total").textContent = totalLabel(T.dealer, T.holeHidden);
    dealer.classList.toggle("is-bust", !T.holeHidden && isBust(T.dealer));

    $("#bj-hands").innerHTML = T.hands.map((h, i) => {
      const v = handValue(h.cards);
      const cls =
        (i === T.active && T.phase === "player" ? " is-active" : "") +
        (isBust(h.cards) ? " is-bust" : "") +
        (h.settled ? { blackjack: " is-bj", win: " is-won", push: "", lose: "", bust: " is-bust" }[h.settled.result] : "");
      return `<div class="bj-hand${cls}">
        <div class="bj-cards">${h.cards.map(c => cardEl(c)).join("")}</div>
        <span class="bj-total">${totalLabel(h.cards)}</span>
        <span class="bj-bet-tag">bet ${wallet().fmt(h.bet)}${h.doubled ? " · doubled" : ""}${h.settled ? " · " + h.settled.result.toUpperCase() : ""}</span>
      </div>`;
    }).join("") || `<div class="bj-hand"><div class="bj-cards"></div><span class="bj-total">place a bet</span></div>`;

    $("#bj-shoe-tag").textContent = `shoe: ${T.shoe.length} cards`;
  }

  function renderControls() {
    const hand = T.hands[T.active];
    const inPlayer = T.phase === "player" && hand;
    const first2 = inPlayer && hand.cards.length === 2;
    const row = $("#bj-play-row");
    row.hidden = T.phase === "betting";
    const set = (act, on, show = true) => {
      const b = row.querySelector(`[data-act="${act}"]`);
      b.disabled = !on;
      b.hidden = !show;
    };
    const ins = T.phase === "insurance";
    set("hit", inPlayer, !ins);
    set("stand", inPlayer, !ins);
    set("double", first2 && wallet().canAfford(hand ? hand.bet : 0), !ins);
    set("split", first2 && T.hands.length === 1 && canSplit(hand.cards) && wallet().canAfford(hand.bet), !ins);
    set("insurance", ins && wallet().canAfford(Math.floor((T.hands[0]?.bet || 0) / 2)), ins);
    set("no-insurance", ins, ins);
  }

  function renderBetUI() {
    $("#bj-status").innerHTML = `Bet: <strong>${wallet().fmt(T.bet)}</strong>`;
  }

  function renderAll() { renderTable(); renderControls(); renderBetUI(); }

  function setLine(text) { const el = $("#bj-line"); if (el) el.textContent = text; }

  function showBanner(result, credited, staked, color) {
    const el = $("#bj-banner");
    const label = { blackjack: "BLACKJACK 💎", win: "YOU WIN", push: "PUSH", lose: "PEPE WINS", bust: "BUST" }[result];
    const net = credited - staked;
    el.style.setProperty("--rb", color);
    el.innerHTML = `<span class="rb-zone">${label}</span>
      <span class="rb-payout ${net > 0 ? "is-win" : "is-loss"}">${net > 0 ? "+" + wallet().fmt(net) : net === 0 ? "stake returned" : wallet().fmt(net)}</span>`;
    el.classList.add("is-shown");
    clearTimeout(el._t);
    el._t = setTimeout(hideBanner, 2400);
  }
  function hideBanner() { $("#bj-banner")?.classList.remove("is-shown"); }

  function pushRecent(result) {
    T.recent.unshift(result);
    T.recent.length = Math.min(T.recent.length, 10);
    $("#bj-recent").innerHTML = T.recent.map(r =>
      `<span class="${r === "win" ? "is-good" : r === "blackjack" ? "is-great" : ""}">${
        { blackjack: "BJ", win: "W", push: "P", lose: "L", bust: "B" }[r]}</span>`).join("");
  }

  document.addEventListener("DOMContentLoaded", buildRoom);

  // model exposed for the sibling harness + future variants
  window.TrollCasinoBlackjack = { buildShoe, handValue, isBlackjack, canSplit, dealerShouldHit, settleHand };
})();

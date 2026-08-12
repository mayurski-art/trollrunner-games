/* Trollrreria — DOM UI layer: HUD (hearts, breath, hotbar, clock/depth),
   inventory + crafting panel, chest panel, tooltips, drag & drop. */

import {
  ITEMS, TILES, T, DAY_LEN, CYCLE, TILE, STATION_SCAN,
  MERCHANT_OFFERS, RECIPES, FUEL, SMELT_TIME, ENCHANTS, ENCHANT_COST, PYLON_OFFER,
} from "./defs.js";
import { getIcon } from "./icons.js";
import { fmtClock } from "./util.js";
import { SURFACE_BASE } from "./worldgen.js";
import { saveGame, saveSettings, isGuest } from "./save.js";
import { QUESTS, questFor, isDone } from "./quests.js";
import { SKINS, isOwned, buySkin, equipSkin, buyRevive } from "./store.js";
import { WAYPOINTS } from "./waypoints.js";

const STATION_CHIP = {
  workbench: ["🔨", "Workbench"],
  furnace: ["🔥", "Furnace"],
  anvil: ["⚒️", "Anvil"],
  campfire: ["🏕️", "Campfire"],
  enchant: ["✨", "Enchant table"],
};

export class UI {
  constructor(game) {
    this.game = game;
    this.el = {
      hud: document.getElementById("hud"),
      hearts: document.getElementById("hud-hearts"),
      hunger: document.getElementById("hud-hunger"),
      stationChips: document.getElementById("hud-stations"),
      breath: document.getElementById("hud-breath"),
      clock: document.getElementById("hud-clock"),
      depth: document.getElementById("hud-depth"),
      hotbar: document.getElementById("hotbar"),
      invPanel: document.getElementById("inv-panel"),
      invGrid: document.getElementById("inv-grid"),
      armorCol: document.getElementById("armor-col"),
      accessoryCol: document.getElementById("accessory-col"),
      trash: document.getElementById("trash-slot"),
      craftList: document.getElementById("craft-list"),
      craftGridEl: document.getElementById("craft-grid"),
      craftOutputEl: document.getElementById("craft-output"),
      chestPanel: document.getElementById("chest-panel"),
      chestGrid: document.getElementById("chest-grid"),
      enchantPanel: document.getElementById("enchant-panel"),
      enchantSlotEl: document.getElementById("enchant-slot"),
      enchantStatus: document.getElementById("enchant-status"),
      btnEnchant: document.getElementById("btn-enchant"),
      cursor: document.getElementById("cursor-item"),
      tooltip: document.getElementById("tooltip"),
      dialog: document.getElementById("dialog"),
      dialogName: document.getElementById("dialog-name"),
      dialogText: document.getElementById("dialog-text"),
      dialogFace: document.getElementById("dialog-face"),
      bossBar: document.getElementById("boss-bar"),
      bossName: document.getElementById("boss-name"),
      bossFill: document.getElementById("boss-fill"),
      minimap: document.getElementById("minimap"),
      bigmap: document.getElementById("bigmap"),
      screenTitle: document.getElementById("screen-title"),
      screenCharpick: document.getElementById("screen-charpick"),
      screenPause: document.getElementById("screen-pause"),
      screenDeath: document.getElementById("screen-death"),
      screenLb: document.getElementById("screen-lb"),
      deathCause: document.getElementById("death-cause"),
      btnContinue: document.getElementById("btn-continue"),
      hotkeysPanel: document.getElementById("hotkeys-panel"),
      btnTravel: document.getElementById("btn-travel"),
      travelPanel: document.getElementById("travel-panel"),
      travelList: document.getElementById("travel-list"),
      pylonPanel: document.getElementById("pylon-panel"),
      pylonList: document.getElementById("pylon-list"),
      questTracker: document.getElementById("quest-tracker"),
      questTitle: document.getElementById("quest-title"),
      questObjectives: document.getElementById("quest-objectives"),
      areaTitle: document.getElementById("area-title"),
      screenStore: document.getElementById("screen-store"),
      storeList: document.getElementById("store-list"),
      storeStatus: document.getElementById("store-status"),
      btnRevive: document.getElementById("btn-revive"),
      reviveCost: document.getElementById("revive-cost"),
      reviveStatus: document.getElementById("revive-status"),
    };
    this._questDirty = true;
    this._areaTimer = null;
    this.hotkeysOpen = false;
    this.travelOpen = false;
    this._adminChecked = false;
    this._hudDirty = true;
    this._invDirty = true;
    this._statusAcc = 0;
    this._craftAcc = 0;
    this.pointerOver = false;
    this.invOpen = false;
    this.chest = null;           // { key, tx, ty, items }
    this.cursor = null;          // dragged stack { id, n }
    this.stations = new Set();
    this.craftGrid = new Array(9).fill(null);   // real 3x3 crafting grid
    this._craftMatch = null;                    // recipe the grid currently satisfies
    this.enchantSlot = null;                    // item currently in the enchant table

    this.buildHotbar();
    this.buildInventory();
    this.el.hud.hidden = false;

    for (const zone of [this.el.hotbar, this.el.invPanel, this.el.chestPanel, this.el.dialog,
                        document.getElementById("shop-panel")]) {
      zone.addEventListener("mouseenter", () => { this.pointerOver = true; });
      zone.addEventListener("mouseleave", () => { this.pointerOver = false; });
    }

    document.addEventListener("mousemove", e => {
      this._mx = e.clientX; this._my = e.clientY;
      if (this.cursor) this.moveCursorEl();
    });

    /* NPC dialog buttons */
    this.dialogNpc = null;
    this.shopNpc = null;
    document.getElementById("shop-close").addEventListener("click", () => this.closeShop());
    document.getElementById("dialog-next").addEventListener("click", () => {
      if (this.dialogNpc) this.el.dialogText.textContent = this.dialogNpc.nextTip();
    });
    document.getElementById("dialog-close").addEventListener("click", () => this.closeDialog());

    /* menu buttons */
    this.bigMapOpen = false;
    this._hadSave = false;
    this._mapAcc = 0;
    this._tileLUT = null;
    this.el.btnContinue.addEventListener("click", () => game.enterPlay());
    document.getElementById("btn-new").addEventListener("click", () => this.showScreens({ charpick: true }));
    document.getElementById("btn-char-prospector").addEventListener("click", () => game.startNewWorld("prospector"));
    document.getElementById("btn-char-gladiator").addEventListener("click", () => game.startNewWorld("gladiator"));
    document.getElementById("btn-charpick-back").addEventListener("click", () => this.showTitle(this._hadSave));
    document.getElementById("btn-title-lb").addEventListener("click", () => {
      this.showScreens({ lb: true });
    });
    document.getElementById("btn-lb-back").addEventListener("click", () => this.showTitle(this._hadSave));
    document.getElementById("btn-resume").addEventListener("click", () => game.enterPlay());
    document.getElementById("btn-save").addEventListener("click", async e => {
      if (isGuest()) {
        // Guests are never persisted -- offer the one-click account path
        // instead of silently no-oping (or a misleading "save failed").
        await window.TrollrunnerAccounts?.confirmGuestExit?.({
          title: "Create an account to save",
          message: "You're not logged in — this world isn't being saved.",
          declineLabel: "Keep playing without saving",
          stayLabel: "Never mind",
          onAccountCreated: () => saveGame(game),
        });
        return;
      }
      e.target.textContent = "💾 Saving…";
      const ok = await saveGame(game);
      e.target.textContent = ok ? "💾 Saved ✓" : "💾 Save failed";
      setTimeout(() => { e.target.textContent = "💾 Save world"; }, 1500);
    });
    document.getElementById("btn-quit").addEventListener("click", () => game.quitToTitle());
    document.getElementById("btn-store").addEventListener("click", () => {
      this.paintStoreList();
      this.showScreens({ store: true });
    });
    document.getElementById("btn-store-back").addEventListener("click", () => this.showScreens({ pause: true }));
    document.getElementById("btn-creative").addEventListener("click", e => {
      game.toggleCreative();
      e.target.textContent = `🛠️ Creative Mode: ${game.creative ? "On" : "Off"}`;
    });
    this.el.btnRevive.addEventListener("click", async () => {
      const admin = window.TrollPay && window.TrollPay.isAdminBypass && window.TrollPay.isAdminBypass();
      this.el.btnRevive.disabled = true;
      this.el.btnRevive.textContent = admin ? "Reviving…" : "Connecting…";
      this.el.reviveStatus.textContent = "";
      const res = await buyRevive(game);
      if (!res.ok) {
        this.el.btnRevive.disabled = false;
        this.el.btnRevive.textContent = "Revive here";
        this.el.reviveStatus.textContent = "⚠ " + res.reason;
      }
      /* on success, game.reviveInPlace() already swapped the screen back
         to the HUD -- nothing left to do here */
    });
    document.getElementById("btn-hotkeys").addEventListener("click", () => this.toggleHotkeys());
    document.getElementById("btn-hotkeys-close").addEventListener("click", () => this.toggleHotkeys(false));
    this.el.btnTravel.addEventListener("click", () => this.toggleTravel());
    document.getElementById("travel-close").addEventListener("click", () => this.toggleTravel(false));
    document.getElementById("pylon-close").addEventListener("click", () => this.closePylonTravel());
    document.getElementById("btn-coop-host").addEventListener("click", () => game.hostCoop());
    document.getElementById("btn-coop-join").addEventListener("click", () =>
      game.joinCoop(document.getElementById("coop-code").value));
    const vol = document.getElementById("vol-slider");
    vol.value = Math.round((game.settings.volume !== undefined ? game.settings.volume : 0.6) * 100);
    vol.addEventListener("input", () => {
      const v = vol.value / 100;
      game.sfx.setVolume(v);
      game.settings.volume = v;
      saveSettings(game.settings);
    });
    const mus = document.getElementById("music-slider");
    mus.value = Math.round((game.settings.music !== undefined ? game.settings.music : 0.5) * 100);
    mus.addEventListener("input", () => {
      const v = mus.value / 100;
      game.music && game.music.setVolume(v);
      game.settings.music = v;
      saveSettings(game.settings);
    });
  }

  /* ------------------------------------------------------------ screens */
  showScreens({ title, charpick, pause, death, lb, store } = {}) {
    this.el.screenTitle.hidden = !title;
    this.el.screenCharpick.hidden = !charpick;
    this.el.screenPause.hidden = !pause;
    this.el.screenDeath.hidden = !death;
    this.el.screenLb.hidden = !lb;
    this.el.screenStore.hidden = !store;
    this.el.hud.hidden = !!(title || charpick || lb);
  }

  showTitle(hasSave) {
    this._hadSave = hasSave;
    this.el.btnContinue.hidden = !hasSave;
    this.showScreens({ title: true });
  }

  showDeath(cause) {
    this.el.deathCause.textContent = "Slain by " + (cause || "the world") + ".";
    this.showScreens({ death: true });
    /* offer the paid revive only when there's a real payment lib to use --
       a guest/offline visitor just gets the free respawn-at-spawn as before,
       which keeps happening on its own timer either way */
    const canPay = !!window.TrollPay;
    const admin = canPay && window.TrollPay.isAdminBypass && window.TrollPay.isAdminBypass();
    this.el.btnRevive.hidden = !canPay;
    if (canPay) {
      // The owner's account never sees a price — just a free revive.
      if (admin) {
        this.el.reviveCost.textContent = "";
      } else {
        const cfg = window.TROLL_PAY_CONFIG || {};
        const price = ((cfg.REVIVE_PRICE_USD || 0.69) * (1 + (cfg.TAX_RATE || 0))).toFixed(2);
        this.el.reviveCost.textContent = "$" + price;
      }
      this.el.reviveStatus.textContent = "";
      this.el.btnRevive.disabled = false;
      this.el.btnRevive.textContent = "Revive here";
    }
  }

  /* --------------------------------------------------------------- maps */
  tileLUT() {
    if (this._tileLUT) return this._tileLUT;
    const lut = new Array(TILES.length).fill(null);
    for (let id = 1; id < TILES.length; id++) {
      const d = TILES[id];
      if (d && d.pal) {
        const p = parseInt(d.pal[1].slice(1), 16);
        lut[id] = [p >> 16, (p >> 8) & 255, p & 255];
      } else {
        lut[id] = [150, 120, 70];
      }
    }
    lut[T.TREE] = [80, 120, 60];
    this._tileLUT = lut;
    return lut;
  }

  /* Write one map pixel into an ImageData buffer. */
  mapPixel(data, o, world, tx, ty, explored) {
    if (!explored) { data[o] = 5; data[o + 1] = 4; data[o + 2] = 10; data[o + 3] = 255; return; }
    const i = ty * world.w + tx;
    const liq = world.liquid[i];
    let c;
    if (liq > 2) {
      c = world.liquidType[i] === 1 ? [255, 94, 20] : [52, 118, 216];
    } else {
      const id = world.tiles[i];
      if (id === T.AIR) {
        if (ty < world.topSolid[tx]) c = [116, 166, 222];
        else c = world.walls[i] ? [42, 33, 26] : [12, 10, 18];
      } else {
        c = this.tileLUT()[id] || [150, 120, 70];
      }
    }
    data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
  }

  paintMinimap() {
    const g = this.game;
    if (!g.player || !g.explored) return;
    const cv = this.el.minimap;
    const ctx = cv.getContext("2d");
    const W = cv.width, H = cv.height;          // 1 px = 2 tiles
    const img = this._mmImg || (this._mmImg = ctx.createImageData(W, H));
    const data = img.data;
    const ptx = Math.floor(g.player.cx / TILE), pty = Math.floor(g.player.cy / TILE);
    const x0 = ptx - W, y0 = pty - H;           // *2 tiles per px, centered
    const w4 = g.world.w >> 2;
    for (let py = 0; py < H; py++) {
      const ty = y0 + py * 2;
      for (let px = 0; px < W; px++) {
        const tx = x0 + px * 2;
        const o = (py * W + px) * 4;
        if (tx < 0 || ty < 0 || tx >= g.world.w || ty >= g.world.h) {
          data[o] = 5; data[o + 1] = 4; data[o + 2] = 10; data[o + 3] = 255;
          continue;
        }
        const exp = g.explored[(ty >> 2) * w4 + (tx >> 2)];
        this.mapPixel(data, o, g.world, tx, ty, exp);
      }
    }
    ctx.putImageData(img, 0, 0);
    /* player dot */
    ctx.fillStyle = "#ffb300";
    ctx.fillRect(W / 2 - 1, H / 2 - 1, 3, 3);
  }

  toggleBigMap(force) {
    this.bigMapOpen = force !== undefined ? force : !this.bigMapOpen;
    const cv = this.el.bigmap;
    cv.hidden = !this.bigMapOpen;
    if (!this.bigMapOpen) return;
    const g = this.game;
    const W = g.world.w >> 1, H = g.world.h >> 1;   // 1 px = 2 tiles, whole world
    const off = this._bigOff || (this._bigOff = document.createElement("canvas"));
    off.width = W; off.height = H;
    const octx = off.getContext("2d");
    const img = octx.createImageData(W, H);
    const data = img.data;
    const w4 = g.world.w >> 2;
    for (let py = 0; py < H; py++) {
      const ty = py * 2;
      for (let px = 0; px < W; px++) {
        const tx = px * 2;
        const exp = g.explored[(ty >> 2) * w4 + (tx >> 2)];
        this.mapPixel(data, (py * W + px) * 4, g.world, tx, ty, exp);
      }
    }
    octx.putImageData(img, 0, 0);
    if (g.player) {
      octx.fillStyle = "#ffb300";
      octx.fillRect((g.player.cx / TILE / 2) - 2, (g.player.cy / TILE / 2) - 2, 4, 4);
    }
    /* fit on screen */
    const scale = Math.min((window.innerWidth * 0.86) / W, (window.innerHeight * 0.82) / H);
    cv.width = Math.round(W * scale);
    cv.height = Math.round(H * scale);
    const ctx = cv.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, cv.width, cv.height);
  }

  /* ---------------------------------------------------------- $TROLL store */
  paintStoreList() {
    const g = this.game;
    const list = this.el.storeList;
    list.innerHTML = "";
    this.el.storeStatus.textContent = window.TrollPay ? "" : "Payments unavailable — reload the page.";
    for (const id in SKINS) {
      const skin = SKINS[id];
      const owned = isOwned(g, id);
      const equipped = g.flags.skin === id;
      const btn = document.createElement("button");
      btn.className = "btn-secondary";
      btn.type = "button";
      btn.style.textAlign = "left";
      btn.textContent = equipped ? `✓ ${skin.name} (equipped)`
        : owned ? `${skin.name} — equip`
        : `${skin.name} — $${skin.priceUsd.toFixed(2)}`;
      btn.disabled = equipped;
      btn.addEventListener("click", async () => {
        if (owned) { equipSkin(g, id); this.paintStoreList(); return; }
        btn.disabled = true;
        btn.textContent = "Connecting…";
        const res = await buySkin(g, id);
        if (!res.ok) this.el.storeStatus.textContent = "⚠ " + res.reason;
        this.paintStoreList();
      });
      list.appendChild(btn);
    }
    if (g.flags.skin) {
      const clear = document.createElement("button");
      clear.className = "btn-ghost";
      clear.type = "button";
      clear.textContent = "Remove skin (back to default troll)";
      clear.addEventListener("click", () => { equipSkin(g, null); this.paintStoreList(); });
      list.appendChild(clear);
    }
  }

  /* ------------------------------------------------------------ dialog */
  openDialog(npc) {
    this.dialogNpc = npc;
    this.el.dialogName.textContent = npc.name;
    const qid = questFor(npc.name);
    const g = this.game;
    if (qid && !isDone(g.quests, qid)) {
      /* first time talking to this NPC while their quest is live: kick it
         off and lead with the quest pitch instead of a random tip */
      if (!g.quests.progress[qid]) g.startQuest(qid);
      this.el.dialogText.textContent = QUESTS[qid].intro;
    } else {
      this.el.dialogText.textContent = npc.tips[npc.tipIdx];
    }
    /* village happiness (Phase 3): a mood line under the tip, for the
       NPCs it applies to -- mood() returns null for everyone else */
    const mood = npc.mood ? npc.mood(g) : null;
    if (mood) {
      this.el.dialogText.textContent += ` (${mood.label}${mood.lines.length ? " — " + mood.lines[0] : ""})`;
    }
    /* each NPC brings their own portrait (+ tint, if their in-world rig
       is tinted) so the dialog face matches who you're talking to */
    if (npc.portrait) {
      const img = document.createElement("img");
      img.src = npc.portrait;
      img.alt = "";
      if (npc.portraitFilter) img.style.filter = npc.portraitFilter;
      this.el.dialogFace.innerHTML = "";
      this.el.dialogFace.appendChild(img);
    } else {
      this.el.dialogFace.textContent = npc.emoji || "😏";
    }
    this.el.dialog.hidden = false;
  }

  closeDialog() {
    this.dialogNpc = null;
    this.el.dialog.hidden = true;
    this.pointerOver = false;
  }

  /* -------------------------------------------------------------- co-op */
  setCoopCode(code) {
    const box = document.getElementById("coop-code");
    if (box) box.value = code;
  }

  /* -------------------------------------------------------------- shop */
  openShop(npc) {
    this.shopNpc = npc;
    document.getElementById("shop-panel").hidden = false;
    this.paintShop();
  }

  closeShop() {
    this.shopNpc = null;
    document.getElementById("shop-panel").hidden = true;
    this.pointerOver = false;
  }

  paintShop() {
    const inv = this.game.inventory;
    const list = document.getElementById("shop-list");
    list.innerHTML = "";
    const npc = this.shopNpc;
    const baseOffers = (npc && npc.offers) || MERCHANT_OFFERS;
    /* village happiness (Phase 3): scales this NPC's own prices ±20%,
       and -- Trader only -- unlocks a Troll Pylon for sale once ≥2 of
       their neighbors are happy (see npc.js TownNPC.mood). */
    const mood = npc && npc.mood ? npc.mood(this.game) : null;
    const priceMod = mood ? mood.priceMod : 1;
    let offers = baseOffers;
    if (npc && npc.profession === "trader" && npc.village) {
      const happyNeighbors = this.game.npcs.filter(n => {
        if (!n.isVillager || n.village !== npc.village || n === npc) return false;
        const m = n.mood && n.mood(this.game);
        return m && m.score >= 1;
      }).length;
      if (happyNeighbors >= 2) offers = [...baseOffers, PYLON_OFFER];
    }
    for (const offer of offers) {
      const give = priceMod === 1 ? offer.give
        : offer.give.map(([id, n]) => [id, Math.max(1, Math.round(n * priceMod))]);
      const can = give.every(([id, n]) => inv.count(id) >= n);
      const row = document.createElement("div");
      row.className = "craft-row shop-row" + (can ? "" : " cant");
      const txt = document.createElement("div");
      const giveStr = give.map(([id, n]) => `${n} ${ITEMS[id].name}`).join(" + ");
      txt.innerHTML =
        `<div class="cr-name">${offer.get[1]} ${ITEMS[offer.get[0]].name}</div>` +
        `<div class="cr-ing">for ${giveStr}</div>`;
      const get = document.createElement("div");
      get.className = "cr-get";
      const cv = document.createElement("canvas");
      cv.width = 32; cv.height = 32;
      cv.getContext("2d").drawImage(getIcon(offer.get[0]), 0, 0);
      get.appendChild(cv);
      row.appendChild(txt);
      row.appendChild(get);
      row.addEventListener("mousedown", e => {
        e.stopPropagation();
        if (!give.every(([id, n]) => inv.count(id) >= n)) return;
        for (const [id, n] of give) inv.consume(id, n);
        const left = inv.add(offer.get[0], offer.get[1]);
        if (left > 0 && this.game.player) {
          this.game.spawnDrop(this.game.player.cx, this.game.player.cy - 8, offer.get[0], left);
        }
        const s = this.game.sfx;
        if (s) s.craft();
        this.dirtyInv();
        this.paintShop();
      });
      list.appendChild(row);
    }
  }

  /* ---------------------------------------------------------- boss bar */
  updateBossBar() {
    const boss = this.game.enemies.find(e => e.boss && !e.dead);
    if (boss) {
      this.el.bossBar.hidden = false;
      this.el.bossName.textContent = boss.enraged ? boss.name + " · TILTED" : boss.name;
      this.el.bossFill.style.width = Math.max(0, (boss.hp / boss.maxHp) * 100).toFixed(1) + "%";
    } else if (!this.el.bossBar.hidden) {
      this.el.bossBar.hidden = true;
    }
  }

  dirtyHud() { this._hudDirty = true; }
  dirtyInv() { this._hudDirty = true; this._invDirty = true; }
  dirtyQuest() { this._questDirty = true; }
  get blocking() { return false; }   // movement stays live with panels open

  /* ------------------------------------------------------- quest tracker */
  paintQuest() {
    const g = this.game;
    const qid = g.quests.active;
    if (!qid) { this.el.questTracker.hidden = true; return; }
    const q = QUESTS[qid];
    const prog = g.quests.progress[qid] || q.objectives.map(() => 0);
    this.el.questTracker.hidden = false;
    this.el.questTitle.textContent = q.title;
    this.el.questObjectives.innerHTML = "";
    q.objectives.forEach((obj, i) => {
      const row = document.createElement("div");
      const done = prog[i] >= obj.n;
      row.className = "quest-obj" + (done ? " done" : "");
      row.innerHTML = `<span>${obj.label}</span><span>${Math.min(prog[i], obj.n)}/${obj.n}</span>`;
      this.el.questObjectives.appendChild(row);
    });
  }

  /* Flashes a biome name briefly on entering a new zone. */
  showAreaTitle(text) {
    const el = this.el.areaTitle;
    el.textContent = text;
    el.hidden = false;
    el.classList.add("show");
    clearTimeout(this._areaTimer);
    this._areaTimer = setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => { el.hidden = true; }, 650);
    }, 2200);
  }

  /* ------------------------------------------------------------ build */
  buildHotbar() {
    this.el.hotbar.innerHTML = "";
    this.hotbarSlots = [];
    for (let i = 0; i < 10; i++) {
      const d = this.makeSlot(i, "inv");
      const k = document.createElement("span");
      k.className = "k";
      k.textContent = (i + 1) % 10;
      d.appendChild(k);
      this.el.hotbar.appendChild(d);
      this.hotbarSlots.push(d);
    }
  }

  buildInventory() {
    this.craftSlots = [];
    this.el.craftGridEl.innerHTML = "";
    for (let i = 0; i < 9; i++) {
      const d = this.makeSlot(i, "craft");
      this.el.craftGridEl.appendChild(d);
      this.craftSlots.push(d);
    }
    this.el.craftOutputEl.addEventListener("mousedown", e => {
      e.stopPropagation();
      e.preventDefault();
      this.clickCraftOutput();
    });
    this.el.craftOutputEl.addEventListener("mouseenter", () => {
      if (this._craftMatch) this.showTip("craft-output", null, this.el.craftOutputEl);
    });
    this.el.craftOutputEl.addEventListener("mouseleave", () => { this.el.tooltip.hidden = true; });

    const enchantSlot = this.makeSlot(0, "enchant");
    this.el.enchantSlotEl.replaceWith(enchantSlot);
    this.el.enchantSlotEl = enchantSlot;
    this.el.btnEnchant.addEventListener("click", () => this.clickEnchant());
    document.getElementById("enchant-close").addEventListener("click", () => this.closeEnchant());

    this.el.invGrid.innerHTML = "";
    this.invSlots = [];
    for (let i = 10; i < 50; i++) {
      const d = this.makeSlot(i, "inv");
      this.el.invGrid.appendChild(d);
      this.invSlots.push(d);
    }
    this.el.armorCol.innerHTML = "";
    this.armorSlots = {};
    for (const [slot, ph] of [["head", "⛑"], ["chest", "🎽"], ["legs", "👖"]]) {
      const d = this.makeSlot(slot, "armor");
      d.classList.add("slot-armor");
      d.dataset.ph = ph;
      this.el.armorCol.appendChild(d);
      this.armorSlots[slot] = d;
    }
    this.el.accessoryCol.innerHTML = "";
    this.accessorySlots = {};
    for (const [slot, ph] of [["ring", "💍"], ["back", "🪽"], ["feet", "👢"]]) {
      const d = this.makeSlot(slot, "accessory");
      d.classList.add("slot-armor");
      d.dataset.ph = ph;
      this.el.accessoryCol.appendChild(d);
      this.accessorySlots[slot] = d;
    }
    this.chestSlots = [];
    this.el.chestGrid.innerHTML = "";
    for (let i = 0; i < 24; i++) {
      const d = this.makeSlot(i, "chest");
      this.el.chestGrid.appendChild(d);
      this.chestSlots.push(d);
    }
    this.el.trash.addEventListener("mousedown", e => {
      e.stopPropagation();
      if (this.cursor) { this.cursor = null; this.moveCursorEl(); this.dirtyInv(); }
    });
  }

  makeSlot(key, kind) {
    const d = document.createElement("div");
    d.className = "slot";
    d.addEventListener("mousedown", e => {
      e.stopPropagation();
      e.preventDefault();
      this.slotClick(kind, key, e.button === 2, e.shiftKey);
    });
    /* touch: fire the click logic on touchstart — no 300ms synthesized-
       mouse delay, and it works even where the browser suppresses the
       synthesized events. This is the only way to switch hotbar items on
       a phone (Digit keys and the wheel don't exist there). */
    d.addEventListener("touchstart", e => {
      e.stopPropagation();
      e.preventDefault();
      this.slotClick(kind, key, false, false);
    }, { passive: false });
    d.addEventListener("contextmenu", e => e.preventDefault());
    d.addEventListener("mouseenter", () => this.showTip(kind, key, d));
    d.addEventListener("mouseleave", () => { this.el.tooltip.hidden = true; });
    return d;
  }

  /* ----------------------------------------------------- slot actions */
  getStack(kind, key) {
    if (kind === "inv") return this.game.inventory.slots[key];
    if (kind === "armor") return this.game.inventory.armor[key];
    if (kind === "accessory") return this.game.inventory.accessory[key];
    if (kind === "chest") return this.chest ? this.chest.items[key] : null;
    if (kind === "craft") return this.craftGrid[key];
    if (kind === "craft-output") return this._craftMatch ? { id: this._craftMatch.out, n: this._craftMatch.n } : null;
    if (kind === "enchant") return this.enchantSlot;
    return null;
  }

  setStack(kind, key, stack) {
    if (kind === "inv") this.game.inventory.slots[key] = stack;
    else if (kind === "armor") this.game.inventory.armor[key] = stack;
    else if (kind === "accessory") this.game.inventory.accessory[key] = stack;
    else if (kind === "chest" && this.chest) this.chest.items[key] = stack;
    else if (kind === "craft") this.craftGrid[key] = stack;
    else if (kind === "enchant") this.enchantSlot = stack;
  }

  slotClick(kind, key, isRight, isShift) {
    const inv = this.game.inventory;
    const cur = this.getStack(kind, key);

    /* hotbar quick-select when nothing is being dragged; clicking the
       already-selected slot again unequips it (bare hands) */
    if (kind === "inv" && key < 10 && !this.cursor && !isShift && !isRight && !this.invOpen) {
      if (inv.sel === key && !inv.unequipped) inv.unequipped = true;
      else { inv.sel = key; inv.unequipped = false; }
      this.dirtyHud();
      return;
    }

    if (isShift && !this.cursor && cur) {
      this.quickMove(kind, key, cur);
      this.dirtyInv();
      return;
    }

    if (kind === "armor" || kind === "accessory") {
      /* armor/accessory slots only accept a matching piece -- item.type is
         literally "armor" or "accessory", so it doubles as the kind check */
      if (this.cursor) {
        const d = ITEMS[this.cursor.id];
        if (!(d.type === kind && d.slot === key)) return;
      }
      const tmp = cur || null;
      this.setStack(kind, key, this.cursor);
      this.cursor = tmp;
      this.afterSlotChange();
      return;
    }

    if (!this.cursor) {
      if (!cur) return;
      if (isRight && cur.n > 1) {
        const half = Math.ceil(cur.n / 2);
        this.cursor = { id: cur.id, n: half };
        cur.n -= half;
      } else {
        this.cursor = cur;
        this.setStack(kind, key, null);
      }
    } else {
      const def = ITEMS[this.cursor.id];
      if (isRight) {
        /* deposit one */
        if (!cur) { this.setStack(kind, key, { id: this.cursor.id, n: 1 }); this.cursor.n--; }
        else if (cur.id === this.cursor.id && cur.n < def.max) { cur.n++; this.cursor.n--; }
        if (this.cursor.n <= 0) this.cursor = null;
      } else if (cur && cur.id === this.cursor.id && def.max > 1) {
        const take = Math.min(this.cursor.n, def.max - cur.n);
        cur.n += take; this.cursor.n -= take;
        if (this.cursor.n <= 0) this.cursor = null;
      } else {
        this.setStack(kind, key, this.cursor);
        this.cursor = cur || null;
      }
    }
    this.afterSlotChange();
  }

  quickMove(kind, key, stack) {
    const inv = this.game.inventory;
    const def = ITEMS[stack.id];
    /* equip armor/accessory via shift-click */
    if (kind !== "armor" && kind !== "accessory" && (def.type === "armor" || def.type === "accessory") && !inv[def.type][def.slot]) {
      inv[def.type][def.slot] = stack;
      this.setStack(kind, key, null);
      return;
    }
    if (kind === "armor" || kind === "accessory") {
      const left = inv.add(stack.id, stack.n);
      if (left === 0) this.setStack(kind, key, null);
      return;
    }
    if (kind === "chest" || kind === "craft" || kind === "enchant") {
      const left = inv.add(stack.id, stack.n);
      this.setStack(kind, key, left > 0 ? { id: stack.id, n: left } : null);
      return;
    }
    /* inv slot */
    if (this.chest) {
      /* push into chest */
      const items = this.chest.items;
      let n = stack.n;
      for (let i = 0; i < items.length && n > 0; i++) {
        const s = items[i];
        if (s && s.id === stack.id && s.n < def.max) {
          const take = Math.min(n, def.max - s.n);
          s.n += take; n -= take;
        }
      }
      for (let i = 0; i < items.length && n > 0; i++) {
        if (!items[i]) { const take = Math.min(n, def.max); items[i] = { id: stack.id, n: take }; n -= take; }
      }
      this.setStack("inv", key, n > 0 ? { id: stack.id, n } : null);
    } else {
      /* hotbar <-> backpack */
      const from = key, target = from < 10 ? [10, 50] : [0, 10];
      let n = stack.n;
      for (let i = target[0]; i < target[1] && n > 0; i++) {
        const s = inv.slots[i];
        if (s && s.id === stack.id && s.n < def.max) {
          const take = Math.min(n, def.max - s.n);
          s.n += take; n -= take;
        }
      }
      for (let i = target[0]; i < target[1] && n > 0; i++) {
        if (!inv.slots[i]) { const take = Math.min(n, def.max); inv.slots[i] = { id: stack.id, n: take }; n -= take; }
      }
      inv.slots[from] = n > 0 ? { id: stack.id, n } : null;
    }
  }

  afterSlotChange() {
    this.moveCursorEl();
    this.dirtyInv();
    const s = this.game.sfx;
    if (s) s.click();
  }

  moveCursorEl() {
    const el = this.el.cursor;
    if (!this.cursor) { el.hidden = true; el.innerHTML = ""; return; }
    el.hidden = false;
    if (!el.firstChild || el.dataset.id !== this.cursor.id || +el.dataset.n !== this.cursor.n) {
      el.dataset.id = this.cursor.id; el.dataset.n = this.cursor.n;
      el.innerHTML = "";
      const cv = document.createElement("canvas");
      cv.width = 32; cv.height = 32;
      cv.getContext("2d").drawImage(getIcon(this.cursor.id), 0, 0);
      el.appendChild(cv);
      if (this.cursor.n > 1) {
        const n = document.createElement("span");
        n.className = "n"; n.textContent = this.cursor.n;
        el.appendChild(n);
      }
    }
    el.style.left = (this._mx || 0) - 19 + "px";
    el.style.top = (this._my || 0) - 19 + "px";
  }

  showTip(kind, key, slotEl) {
    const stack = this.getStack(kind, key);
    if (!stack) { this.el.tooltip.hidden = true; return; }
    const def = ITEMS[stack.id];
    const bits = [`<div class="tip-name">${def.name}</div>`];
    const sub = [];
    if (def.type === "tool") sub.push(`${def.tool} · ${def.power}% power`);
    if (def.type === "weapon" || def.type === "bow") sub.push(`${def.dmg} damage`);
    if (def.type === "ammo") sub.push(`+${def.dmg} arrow damage`);
    if (def.type === "armor") sub.push(`+${def.def} defense · ${def.slot}`);
    if (def.type === "accessory") {
      const perks = [];
      if (def.def) perks.push(`+${def.def} defense`);
      if (def.speedMult) perks.push(`+${Math.round((def.speedMult - 1) * 100)}% speed`);
      if (def.jumpBoost) perks.push("higher jump");
      if (def.doubleJump) perks.push("extra jump");
      if (def.glide) perks.push("glide");
      if (def.dash) perks.push("dash");
      if (def.regen) perks.push("faster regen");
      sub.push(perks.join(" · "));
    }
    if (def.type === "potion") sub.push(`heals ${def.heal} HP`);
    if (def.type === "block") sub.push("placeable");
    if (def.type === "wall") sub.push("background wall");
    if (def.desc) sub.push(def.desc);
    if (stack.ench) sub.push(`✨ ${stack.ench.name}`);
    if (sub.length) bits.push(`<div class="tip-sub">${sub.join("<br>")}</div>`);
    const tip = this.el.tooltip;
    tip.innerHTML = bits.join("");
    tip.hidden = false;
    const r = slotEl.getBoundingClientRect();
    tip.style.left = Math.min(window.innerWidth - 250, r.right + 8) + "px";
    tip.style.top = Math.max(8, r.top - 4) + "px";
  }

  /* ------------------------------------------------------------ panels */
  toggleHotkeys(force) {
    this.hotkeysOpen = force !== undefined ? force : !this.hotkeysOpen;
    this.el.hotkeysPanel.hidden = !this.hotkeysOpen;
  }

  toggleTravel(force) {
    if (!this.game.isAdmin()) return;
    this.travelOpen = force !== undefined ? force : !this.travelOpen;
    this.el.travelPanel.hidden = !this.travelOpen;
    if (this.travelOpen) this.paintTravelList();
  }

  paintTravelList() {
    const list = this.el.travelList;
    list.innerHTML = "";
    for (const wp of WAYPOINTS) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "travel-row";
      row.textContent = `🧭 ${wp.name}`;
      row.addEventListener("click", () => {
        this.game.teleportTo(wp.id);
        this.toggleTravel(false);
      });
      list.appendChild(row);
    }
  }

  /* Troll Pylon network: player-facing fast travel, unlike the admin-only
     WAYPOINTS panel above -- opened by right-clicking any placed pylon
     (Game.interact, main.js), lists every OTHER pylon Game.listPylons()
     finds by scanning the tile grid. */
  openPylonTravel(fromTx, fromTy) {
    this.pylonOpen = true;
    this.pylonFrom = { tx: fromTx, ty: fromTy };
    this.el.pylonPanel.hidden = false;
    this.paintPylonList();
    this.pointerOver = true;
  }

  closePylonTravel() {
    this.pylonOpen = false;
    this.el.pylonPanel.hidden = true;
    this.pointerOver = false;
  }

  paintPylonList() {
    const list = this.el.pylonList;
    list.innerHTML = "";
    const g = this.game;
    const from = this.pylonFrom;
    const pylons = g.listPylons().filter(p => Math.abs(p.tx - from.tx) > 2 || Math.abs(p.ty - from.ty) > 2);
    if (!pylons.length) {
      list.innerHTML = `<div class="cr-ing" style="padding:6px">No other pylons placed yet.</div>`;
      return;
    }
    for (const p of pylons) {
      const label = g.pylonLabel(p.tx, p.ty);
      const row = document.createElement("button");
      row.type = "button";
      row.className = "travel-row";
      row.textContent = `🔮 ${label}`;
      row.addEventListener("click", () => {
        g.warpPlayerTo(p.tx, p.ty, label);
        this.closePylonTravel();
      });
      list.appendChild(row);
    }
  }

  toggleInventory(force) {
    this.invOpen = force !== undefined ? force : !this.invOpen;
    this.el.invPanel.hidden = !this.invOpen;
    if (!this.invOpen) {
      this.closeChest();
      this.closeEnchant();
      this.dropCursor();
      this.returnCraftGrid();
      this.pointerOver = false;
      this.el.tooltip.hidden = true;
    } else {
      this.refreshStations();
      this.dirtyInv();
    }
  }

  dropCursor() {
    if (!this.cursor) return;
    const left = this.game.inventory.add(this.cursor.id, this.cursor.n);
    if (left > 0 && this.game.player) {
      this.game.spawnDrop(this.game.player.cx, this.game.player.cy - 8, this.cursor.id, left,
        (this.game.player.dir || 1) * 150);
    }
    this.cursor = null;
    this.moveCursorEl();
  }

  openChest(tx, ty) {
    const key = this.game.world.chestKey(tx, ty);
    const c = this.game.world.chests.get(key);
    if (!c) return;
    this.chest = { key, tx, ty, items: c.items };
    this.el.chestPanel.hidden = false;
    if (!this.invOpen) this.toggleInventory(true);
    this.paintChest();
    const s = this.game.sfx;
    if (s) s.door();
  }

  closeChest() {
    /* co-op: share final chest contents when we're done rummaging */
    if (this.chest && this.game.net && this.game.net.active) {
      this.game.net.send({
        t: "chest", id: this.game.net.id,
        key: this.chest.key, items: this.chest.items,
      });
    }
    this.chest = null;
    this.el.chestPanel.hidden = true;
  }

  closeChestIf(key) {
    if (this.chest && this.chest.key === key) this.closeChest();
  }

  openEnchant() {
    this.enchantOpen = true;
    this.el.enchantPanel.hidden = false;
    if (!this.invOpen) this.toggleInventory(true);
    this.paintEnchant();
    const s = this.game.sfx;
    if (s) s.door();
  }

  closeEnchant() {
    this.enchantOpen = false;
    this.el.enchantPanel.hidden = true;
    if (this.enchantSlot) {
      const inv = this.game.inventory;
      const left = inv.add(this.enchantSlot.id, this.enchantSlot.n);
      if (left > 0 && this.game.player) {
        this.game.spawnDrop(this.game.player.cx, this.game.player.cy - 8, this.enchantSlot.id, left,
          (this.game.player.dir || 1) * 150);
      }
      this.enchantSlot = null;
    }
  }

  /* Enchantable = tool, weapon, or armor -- the three types withEnchant()
     (player.js) and totalDefense() (inventory.js) know how to apply a
     bonus to. Everything else just can't go in the slot meaningfully. */
  paintEnchant() {
    this.paintSlot(this.el.enchantSlotEl, this.enchantSlot);
    const inv = this.game.inventory;
    const s = this.enchantSlot;
    const def = s && ITEMS[s.id];
    const enchantable = def && ENCHANTS[def.type];
    const costText = ENCHANT_COST.map(([id, n]) => `${n} ${ITEMS[id].name}${inv.count(id) < n ? " ✗" : ""}`).join(", ");
    const haveCost = ENCHANT_COST.every(([id, n]) => inv.count(id) >= n);
    let status;
    if (!s) status = "Place a tool, weapon, or armor piece";
    else if (!enchantable) status = "That can't be enchanted";
    else status = `Cost: ${costText}` + (s.ench ? ` — currently ${s.ench.name}` : "");
    this.el.enchantStatus.textContent = status;
    this.el.btnEnchant.disabled = !(enchantable && haveCost);
  }

  clickEnchant() {
    const inv = this.game.inventory;
    const s = this.enchantSlot;
    const def = s && ITEMS[s.id];
    const pool = def && ENCHANTS[def.type];
    if (!pool || !ENCHANT_COST.every(([id, n]) => inv.count(id) >= n)) return;
    for (const [id, n] of ENCHANT_COST) inv.consume(id, n);
    s.ench = pool[Math.floor(Math.random() * pool.length)];
    this.game.announce && this.game.announce(`✨ ${s.ench.name}!`);
    const sfx = this.game.sfx;
    if (sfx) sfx.craft();
    this.paintEnchant();
  }

  refreshStations() {
    const p = this.game.player;
    if (!p) return;
    this.stations = this.game.world.stationsNear(
      Math.floor(p.cx / TILE), Math.floor(p.cy / TILE), STATION_SCAN
    );
  }

  /* Surfaces the same proximity scan the crafting panel uses, but always
     visible -- so the "stand near a station" mechanic isn't only legible
     once you've already opened the inventory to find out. */
  paintStationChips() {
    const box = this.el.stationChips;
    if (!box) return;
    const names = [...this.stations].sort();
    const key = names.join();
    if (this._stationChipKey === key) return;
    this._stationChipKey = key;
    box.innerHTML = "";
    for (const name of names) {
      const [icon, label] = STATION_CHIP[name] || ["⚙️", name];
      const chip = document.createElement("span");
      chip.className = "station-chip";
      chip.textContent = `${icon} ${label}`;
      box.appendChild(chip);
    }
    box.hidden = names.length === 0;
  }

  /* The list is now a recipe browser, not an instant-craft button: clicking
     a row pulls that recipe's ingredients out of the bag and into the real
     3x3 grid below, where the output slot does the actual crafting (so
     manually dragging items into the grid works exactly the same way). */
  paintCraftList() {
    const inv = this.game.inventory;
    const rows = inv.visibleRecipes(this.stations);
    const list = this.el.craftList;
    list.innerHTML = "";
    if (this.stations.has("furnace")) {
      const fuel = this.game.flags.furnaceFuel;
      const status = this.game.smeltCooldown > 0 ? "🔥 smelting…"
        : fuel > 0 ? `🔥 lit — ${Math.ceil(fuel)}s fuel left`
        : "🔥 unlit — smelting will use 1 wood";
      const bar = document.createElement("div");
      bar.className = "cr-ing";
      bar.style.padding = "4px 6px";
      bar.textContent = status;
      list.appendChild(bar);
    }
    if (this.stations.has("campfire")) {
      const bar = document.createElement("div");
      bar.className = "cr-ing";
      bar.style.padding = "4px 6px";
      bar.textContent = "🏕️ crackling — ready to cook";
      list.appendChild(bar);
    }
    for (const { recipe, can } of rows) {
      const def = ITEMS[recipe.out];
      const row = document.createElement("div");
      row.className = "craft-row" + (can ? "" : " cant");
      const cv = document.createElement("canvas");
      cv.width = 32; cv.height = 32;
      cv.getContext("2d").drawImage(getIcon(recipe.out), 0, 0);
      row.appendChild(cv);
      const txt = document.createElement("div");
      const ing = recipe.ing
        .map(([id, n]) => `${n} ${ITEMS[id].name}${inv.count(id) < n ? " ✗" : ""}`)
        .join(", ");
      txt.innerHTML =
        `<div class="cr-name">${def.name}${recipe.n > 1 ? " ×" + recipe.n : ""}</div>` +
        `<div class="cr-ing">${ing}${recipe.station ? " · @ " + recipe.station : ""}</div>`;
      row.appendChild(txt);
      row.addEventListener("mousedown", e => {
        e.stopPropagation();
        if (!can) return;
        /* clicking the same recipe that's already loaded (and matches)
           crafts it directly -- without this, a player who doesn't
           notice the separate output slot below just sees the row
           "do nothing" on a second click, which reads as broken
           (this is exactly what furnace smelting looked like). */
        if (this._craftMatch === recipe) this.clickCraftOutput();
        else this.fillCraftGrid(recipe);
      });
      list.appendChild(row);
    }
    if (!rows.length) {
      list.innerHTML = `<div class="cr-ing" style="padding:6px">Gather materials or stand near a station…</div>`;
    }
  }

  /* Find the recipe (if any) whose ingredients exactly match what's
     currently sitting in the grid -- shapeless, aggregate match (position
     within the 3x3 doesn't matter), same as tossing items in and seeing
     what lines up. */
  matchRecipe() {
    const counts = new Map();
    for (const s of this.craftGrid) if (s) counts.set(s.id, (counts.get(s.id) || 0) + s.n);
    if (counts.size === 0) return null;
    for (const r of RECIPES) {
      if (r.station && !this.stations.has(r.station)) continue;
      if (r.ing.length !== counts.size) continue;
      if (r.ing.every(([id, n]) => counts.get(id) === n)) return r;
    }
    return null;
  }

  paintCraftGrid() {
    for (let i = 0; i < 9; i++) this.paintSlot(this.craftSlots[i], this.craftGrid[i]);
    const match = this.matchRecipe();
    this._craftMatch = match;
    this.paintSlot(this.el.craftOutputEl, match ? { id: match.out, n: match.n } : null);
    this.el.craftOutputEl.classList.toggle("has-result", !!match);
  }

  /* Pull a recipe's ingredients out of the bag and into the grid so the
     player doesn't have to hunt-and-drag every item by hand -- purely a
     shortcut, identical result to placing them manually. */
  fillCraftGrid(recipe) {
    this.returnCraftGrid();
    const inv = this.game.inventory;
    if (!inv.canCraft(recipe, this.stations)) return;
    let slot = 0;
    for (const [id, n] of recipe.ing) {
      inv.consume(id, n);
      this.craftGrid[slot++] = { id, n };
    }
    this.dirtyInv();
    /* paint the grid + output slot right away instead of waiting on the
       ~0.5s craft-panel tick -- otherwise a same-row second click can
       land before _craftMatch is even set to this recipe yet. */
    this.paintCraftGrid();
  }

  /* Hand back whatever's sitting in the grid (e.g. closing the inventory
     mid-craft, or loading up a different recipe) -- nothing is ever lost. */
  returnCraftGrid() {
    const inv = this.game.inventory;
    for (let i = 0; i < 9; i++) {
      const s = this.craftGrid[i];
      if (s) {
        const left = inv.add(s.id, s.n);
        if (left > 0 && this.game.player) {
          this.game.spawnDrop(this.game.player.cx, this.game.player.cy - 8, s.id, left,
            (this.game.player.dir || 1) * 150);
        }
        this.craftGrid[i] = null;
      }
    }
  }

  /* The one real crafting action: consumes the exact grid contents (the
     match guarantees there's nothing extra sitting in it) and grants the
     output, routing furnace recipes through the same fuel/cooldown gate
     as before. */
  clickCraftOutput() {
    const recipe = this._craftMatch;
    if (!recipe || this.cursor) return;
    const inv = this.game.inventory;
    const game = this.game;
    if (recipe.station === "furnace") {
      if (game.smeltCooldown > 0) { game.announce && game.announce("smelting…"); return; }
      if (game.flags.furnaceFuel <= 0) {
        if (inv.count("wood") < 1) { game.announce && game.announce("needs wood for fuel"); return; }
        inv.consume("wood", 1);
        game.flags.furnaceFuel = FUEL.wood;
      }
    }
    const def = ITEMS[recipe.out];
    let space = 0;
    for (const s of inv.slots) { if (!s) space += def.max; else if (s.id === recipe.out) space += def.max - s.n; }
    if (space < recipe.n) { game.announce && game.announce("bag full"); return; }
    for (let i = 0; i < 9; i++) this.craftGrid[i] = null;
    inv.add(recipe.out, recipe.n);
    if (recipe.station === "furnace") game.smeltCooldown = SMELT_TIME;
    const s = game.sfx;
    if (s) s.craft();
    this.dirtyInv();
  }

  paintChest() {
    if (!this.chest) return;
    for (let i = 0; i < 24; i++) this.paintSlot(this.chestSlots[i], this.chest.items[i]);
  }

  /* Fill one slot element from an item stack ({id,n} | null). */
  paintSlot(el, stack) {
    let cv = el.querySelector("canvas");
    let nEl = el.querySelector(".n");
    if (!stack) {
      if (cv) cv.remove();
      if (nEl) nEl.remove();
      el.title = "";
      return;
    }
    if (!cv) { cv = document.createElement("canvas"); cv.width = 32; cv.height = 32; el.appendChild(cv); }
    const g = cv.getContext("2d");
    g.clearRect(0, 0, 32, 32);
    g.drawImage(getIcon(stack.id), 0, 0);
    if (stack.n > 1) {
      if (!nEl) { nEl = document.createElement("span"); nEl.className = "n"; el.appendChild(nEl); }
      nEl.textContent = stack.n;
    } else if (nEl) nEl.remove();
  }

  /* ------------------------------------------------------------ update */
  update(dt) {
    const g = this.game;
    const input = g.input;

    if (input.hit("KeyE")) this.toggleInventory();
    if (input.hit("KeyM")) this.toggleBigMap();
    if (input.hit("F1")) this.toggleHotkeys();
    if (input.hit("KeyT")) this.toggleTravel();
    /* admin status resolves async (profile loads after login) -- a cheap
       boolean check each frame is fine, and it flips the button on the
       moment troll_runner's session is actually ready. */
    const admin = g.isAdmin();
    if (admin !== this._adminChecked) {
      this._adminChecked = admin;
      this.el.btnTravel.hidden = !admin;
      if (!admin) this.toggleTravel(false);
    }
    if (input.hit("Escape")) {
      if (this.bigMapOpen) this.toggleBigMap(false);
      else if (this.shopNpc) this.closeShop();
      else if (this.dialogNpc) this.closeDialog();
      else if (this.pylonOpen) this.closePylonTravel();
      else if (this.invOpen) this.toggleInventory(false);
    }
    this.updateBossBar();

    /* close the shop when wandering off */
    if (this.shopNpc && g.player) {
      if (Math.abs(this.shopNpc.cx - g.player.cx) > TILE * 10) this.closeShop();
    }

    /* minimap refresh */
    this._mapAcc += dt;
    if (this._mapAcc >= 0.5) {
      this._mapAcc = 0;
      this.paintMinimap();
    }

    /* close dialog when the guide wanders off */
    if (this.dialogNpc && g.player) {
      if (Math.abs(this.dialogNpc.cx - g.player.cx) > TILE * 10) this.closeDialog();
    }

    /* auto-close chest when walking away */
    if (this.chest && g.player) {
      const d = Math.hypot(
        (this.chest.tx + 0.5) * TILE - g.player.cx,
        (this.chest.ty + 0.5) * TILE - g.player.cy
      );
      if (d > TILE * (REACH_CLOSE)) this.closeChest();
    }

    this._statusAcc += dt;
    if (this._statusAcc > 0.25) {
      this._statusAcc = 0;
      this.el.clock.textContent = `Day ${g.dayCount} · ${fmtClock(g.time, DAY_LEN, CYCLE - DAY_LEN)}`;
      const coop = document.getElementById("hud-coop");
      if (g.net && g.net.active) {
        coop.hidden = false;
        coop.textContent = `🌐 ${g.net.room} · ${g.net.peerCount + 1} troll${g.net.peerCount ? "s" : ""}${g.pvp ? " · ⚔️ PvP" : ""}`;
      } else if (!coop.hidden) coop.hidden = true;
      if (g.player) {
        const depthTiles = Math.floor(g.player.y / TILE) - SURFACE_BASE;
        this.el.depth.textContent = depthTiles > 4 ? `${depthTiles * 2} ft deep` : "Surface";
        this.paintHunger();
        if (!this.invOpen) this.refreshStations();
        this.paintStationChips();
        const buffEl = document.getElementById("hud-buff");
        const buff = g.player.buffs && g.player.buffs.get("wellFed");
        if (buff) {
          buffEl.hidden = false;
          const m = Math.floor(buff.timeLeft / 60), s = Math.floor(buff.timeLeft % 60);
          buffEl.textContent = `🍲 ${buff.label} ${m}:${s < 10 ? "0" : ""}${s}`;
        } else if (!buffEl.hidden) buffEl.hidden = true;
        const showBreath = g.player.breath < g.player.maxBreath - 0.05;
        this.el.breath.hidden = !showBreath;
        if (showBreath) {
          const want = Math.ceil(g.player.breath);
          if (this._breathN !== want) {
            this._breathN = want;
            this.el.breath.innerHTML = "";
            for (let i = 0; i < want; i++) {
              const b = document.createElement("span");
              b.className = "bubble";
              this.el.breath.appendChild(b);
            }
          }
        }
      }
    }

    /* stations refresh while inventory is open */
    if (this.invOpen) {
      this._craftAcc += dt;
      if (this._craftAcc > 0.5) {
        this._craftAcc = 0;
        const before = [...this.stations].sort().join();
        this.refreshStations();
        if ([...this.stations].sort().join() !== before) this._invDirty = true;
      }
    }

    if (this._hudDirty) {
      this._hudDirty = false;
      this.paintHearts();
      this.paintHunger();
      this.paintHotbar();
    }
    if (this._questDirty) {
      this._questDirty = false;
      this.paintQuest();
    }
    if (this._invDirty) {
      this._invDirty = false;
      if (this.invOpen) {
        for (let i = 10; i < 50; i++) this.paintSlot(this.invSlots[i - 10], g.inventory.slots[i]);
        for (const k of ["head", "chest", "legs"]) this.paintSlot(this.armorSlots[k], g.inventory.armor[k]);
        for (const k of ["ring", "back", "feet"]) this.paintSlot(this.accessorySlots[k], g.inventory.accessory[k]);
        this.paintCraftList();
        this.paintCraftGrid();
        if (this.enchantOpen) this.paintEnchant();
      }
      this.paintChest();
      this.moveCursorEl();
    }
  }

  paintHearts() {
    const p = this.game.player;
    if (!p) return;
    const total = Math.round(p.maxHp / 20);
    const full = p.hp / 20;
    const box = this.el.hearts;
    box.innerHTML = "";
    for (let i = 0; i < total; i++) {
      const h = document.createElement("span");
      h.className = "heart" + (i + 0.5 > full ? " empty" : "");
      h.textContent = "🧡";
      box.appendChild(h);
    }
  }

  paintHunger() {
    const p = this.game.player;
    if (!p) return;
    const total = Math.round(p.maxHunger / 20);
    const full = p.hunger / 20;
    const starving = p.hunger <= 0;
    if (this._hungerN === full && this._hungerStarving === starving) return;
    this._hungerN = full; this._hungerStarving = starving;
    const box = this.el.hunger;
    box.innerHTML = "";
    for (let i = 0; i < total; i++) {
      const h = document.createElement("span");
      h.className = "hunger" + (i + 0.5 > full ? " empty" : "") + (starving ? " starving" : "");
      h.textContent = "🍖";
      box.appendChild(h);
    }
  }

  paintHotbar() {
    const inv = this.game.inventory;
    for (let i = 0; i < 10; i++) {
      const el = this.hotbarSlots[i];
      el.classList.toggle("sel", inv.sel === i && !inv.unequipped);
      el.classList.toggle("unequipped", inv.sel === i && inv.unequipped);
      this.paintSlot(el, inv.slots[i]);
    }
  }
}

const REACH_CLOSE = 9;

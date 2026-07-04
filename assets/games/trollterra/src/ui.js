/* TrollTerra — DOM UI layer: HUD (hearts, breath, hotbar, clock/depth),
   inventory + crafting panel, chest panel, tooltips, drag & drop. */

import { ITEMS, DAY_LEN, CYCLE, TILE, STATION_SCAN } from "./defs.js";
import { getIcon } from "./icons.js";
import { fmtClock } from "./util.js";
import { SURFACE_BASE } from "./worldgen.js";

export class UI {
  constructor(game) {
    this.game = game;
    this.el = {
      hud: document.getElementById("hud"),
      hearts: document.getElementById("hud-hearts"),
      breath: document.getElementById("hud-breath"),
      clock: document.getElementById("hud-clock"),
      depth: document.getElementById("hud-depth"),
      hotbar: document.getElementById("hotbar"),
      invPanel: document.getElementById("inv-panel"),
      invGrid: document.getElementById("inv-grid"),
      armorCol: document.getElementById("armor-col"),
      trash: document.getElementById("trash-slot"),
      craftList: document.getElementById("craft-list"),
      chestPanel: document.getElementById("chest-panel"),
      chestGrid: document.getElementById("chest-grid"),
      cursor: document.getElementById("cursor-item"),
      tooltip: document.getElementById("tooltip"),
      dialog: document.getElementById("dialog"),
    };
    this._hudDirty = true;
    this._invDirty = true;
    this._statusAcc = 0;
    this._craftAcc = 0;
    this.pointerOver = false;
    this.invOpen = false;
    this.chest = null;           // { key, tx, ty, items }
    this.cursor = null;          // dragged stack { id, n }
    this.stations = new Set();

    this.buildHotbar();
    this.buildInventory();
    this.el.hud.hidden = false;

    for (const zone of [this.el.hotbar, this.el.invPanel, this.el.chestPanel, this.el.dialog]) {
      zone.addEventListener("mouseenter", () => { this.pointerOver = true; });
      zone.addEventListener("mouseleave", () => { this.pointerOver = false; });
    }

    document.addEventListener("mousemove", e => {
      this._mx = e.clientX; this._my = e.clientY;
      if (this.cursor) this.moveCursorEl();
    });
  }

  dirtyHud() { this._hudDirty = true; }
  dirtyInv() { this._hudDirty = true; this._invDirty = true; }
  get blocking() { return false; }   // movement stays live with panels open

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
    d.addEventListener("contextmenu", e => e.preventDefault());
    d.addEventListener("mouseenter", () => this.showTip(kind, key, d));
    d.addEventListener("mouseleave", () => { this.el.tooltip.hidden = true; });
    return d;
  }

  /* ----------------------------------------------------- slot actions */
  getStack(kind, key) {
    if (kind === "inv") return this.game.inventory.slots[key];
    if (kind === "armor") return this.game.inventory.armor[key];
    if (kind === "chest") return this.chest ? this.chest.items[key] : null;
    return null;
  }

  setStack(kind, key, stack) {
    if (kind === "inv") this.game.inventory.slots[key] = stack;
    else if (kind === "armor") this.game.inventory.armor[key] = stack;
    else if (kind === "chest" && this.chest) this.chest.items[key] = stack;
  }

  slotClick(kind, key, isRight, isShift) {
    const inv = this.game.inventory;
    const cur = this.getStack(kind, key);

    /* hotbar quick-select when nothing is being dragged */
    if (kind === "inv" && key < 10 && !this.cursor && !isShift && !isRight && !this.invOpen) {
      inv.sel = key;
      this.dirtyHud();
      return;
    }

    if (isShift && !this.cursor && cur) {
      this.quickMove(kind, key, cur);
      this.dirtyInv();
      return;
    }

    if (kind === "armor") {
      /* armor slots only accept the matching piece */
      if (this.cursor) {
        const d = ITEMS[this.cursor.id];
        if (!(d.type === "armor" && d.slot === key)) return;
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
    /* equip armor via shift-click */
    if (kind !== "armor" && def.type === "armor" && !inv.armor[def.slot]) {
      inv.armor[def.slot] = stack;
      this.setStack(kind, key, null);
      return;
    }
    if (kind === "armor") {
      const left = inv.add(stack.id, stack.n);
      if (left === 0) this.setStack(kind, key, null);
      return;
    }
    if (kind === "chest") {
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
    if (def.type === "potion") sub.push(`heals ${def.heal} HP`);
    if (def.type === "block") sub.push("placeable");
    if (def.type === "wall") sub.push("background wall");
    if (def.desc) sub.push(def.desc);
    if (sub.length) bits.push(`<div class="tip-sub">${sub.join("<br>")}</div>`);
    const tip = this.el.tooltip;
    tip.innerHTML = bits.join("");
    tip.hidden = false;
    const r = slotEl.getBoundingClientRect();
    tip.style.left = Math.min(window.innerWidth - 250, r.right + 8) + "px";
    tip.style.top = Math.max(8, r.top - 4) + "px";
  }

  /* ------------------------------------------------------------ panels */
  toggleInventory(force) {
    this.invOpen = force !== undefined ? force : !this.invOpen;
    this.el.invPanel.hidden = !this.invOpen;
    if (!this.invOpen) {
      this.closeChest();
      this.dropCursor();
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
    this.chest = null;
    this.el.chestPanel.hidden = true;
  }

  closeChestIf(key) {
    if (this.chest && this.chest.key === key) this.closeChest();
  }

  refreshStations() {
    const p = this.game.player;
    if (!p) return;
    this.stations = this.game.world.stationsNear(
      Math.floor(p.cx / TILE), Math.floor(p.cy / TILE), STATION_SCAN
    );
  }

  paintCraftList() {
    const inv = this.game.inventory;
    const rows = inv.visibleRecipes(this.stations);
    const list = this.el.craftList;
    list.innerHTML = "";
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
        if (inv.craft(recipe, this.stations)) {
          const s = this.game.sfx;
          if (s) s.craft();
          this.dirtyInv();
        }
      });
      list.appendChild(row);
    }
    if (!rows.length) {
      list.innerHTML = `<div class="cr-ing" style="padding:6px">Gather materials or stand near a station…</div>`;
    }
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
    if (input.hit("Escape")) {
      if (this.invOpen) this.toggleInventory(false);
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
      if (g.player) {
        const depthTiles = Math.floor(g.player.y / TILE) - SURFACE_BASE;
        this.el.depth.textContent = depthTiles > 4 ? `${depthTiles * 2} ft deep` : "Surface";
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
      this.paintHotbar();
    }
    if (this._invDirty) {
      this._invDirty = false;
      if (this.invOpen) {
        for (let i = 10; i < 50; i++) this.paintSlot(this.invSlots[i - 10], g.inventory.slots[i]);
        for (const k of ["head", "chest", "legs"]) this.paintSlot(this.armorSlots[k], g.inventory.armor[k]);
        this.paintCraftList();
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

  paintHotbar() {
    const inv = this.game.inventory;
    for (let i = 0; i < 10; i++) {
      const el = this.hotbarSlots[i];
      el.classList.toggle("sel", inv.sel === i);
      this.paintSlot(el, inv.slots[i]);
    }
  }
}

const REACH_CLOSE = 9;

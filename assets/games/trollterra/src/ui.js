/* TrollTerra — DOM UI layer: HUD (hearts, breath, hotbar, clock/depth).
   Inventory / crafting / chest panels are wired in by later sections. */

import { ITEMS, DAY_LEN, CYCLE, TILE } from "./defs.js";
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
    };
    this._hudDirty = true;
    this._invDirty = true;
    this._statusAcc = 0;
    this.pointerOver = false;

    this.buildHotbar();
    this.el.hud.hidden = false;

    /* track pointer over interactive UI so clicks don't mine through panels */
    for (const zone of [this.el.hotbar]) {
      zone.addEventListener("mouseenter", () => { this.pointerOver = true; });
      zone.addEventListener("mouseleave", () => { this.pointerOver = false; });
    }
  }

  dirtyHud() { this._hudDirty = true; }
  dirtyInv() { this._hudDirty = true; this._invDirty = true; }

  buildHotbar() {
    this.el.hotbar.innerHTML = "";
    this.hotbarSlots = [];
    for (let i = 0; i < 10; i++) {
      const d = document.createElement("div");
      d.className = "slot";
      d.dataset.i = i;
      const k = document.createElement("span");
      k.className = "k";
      k.textContent = (i + 1) % 10;
      d.appendChild(k);
      d.addEventListener("mousedown", e => {
        e.stopPropagation();
        this.game.inventory.sel = i;
        this.dirtyHud();
      });
      this.el.hotbar.appendChild(d);
      this.hotbarSlots.push(d);
    }
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
    el.title = ITEMS[stack.id] ? ITEMS[stack.id].name : stack.id;
  }

  update(dt) {
    const g = this.game;
    this._statusAcc += dt;
    if (this._statusAcc > 0.25) {
      this._statusAcc = 0;
      this.el.clock.textContent = `Day ${g.dayCount} · ${fmtClock(g.time, DAY_LEN, CYCLE - DAY_LEN)}`;
      if (g.player) {
        const depthTiles = Math.floor(g.player.y / TILE) - SURFACE_BASE;
        this.el.depth.textContent = depthTiles > 4 ? `${depthTiles * 2} ft deep` : "Surface";
        /* breath bubbles only while diving */
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

    if (this._hudDirty) {
      this._hudDirty = false;
      this.paintHearts();
      this.paintHotbar();
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

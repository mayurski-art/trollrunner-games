/* Trollrreria — inventory model: 10 hotbar + 40 backpack slots, 3 armor
   slots, stacking, crafting checks. Slot = { id, n } or null. */

import { ITEMS, RECIPES } from "./defs.js";

export const INV_SIZE = 50;   // 0-9 hotbar, 10-49 backpack

export class Inventory {
  constructor() {
    this.slots = new Array(INV_SIZE).fill(null);
    this.armor = { head: null, chest: null, legs: null };
    this.accessory = { ring: null, back: null, feet: null };
    this.sel = 0;              // selected hotbar index
    this.unequipped = false;   // true = bare hands, even though `sel` still points at a slot
  }

  get selected() { return this.unequipped ? null : this.slots[this.sel]; }

  /* Add items; returns count that did NOT fit. Fills existing stacks first. */
  add(id, n) {
    const def = ITEMS[id];
    if (!def) return n;
    if (def.max > 1) {
      for (let i = 0; i < INV_SIZE && n > 0; i++) {
        const s = this.slots[i];
        if (s && s.id === id && s.n < def.max) {
          const take = Math.min(n, def.max - s.n);
          s.n += take; n -= take;
        }
      }
    }
    for (let i = 0; i < INV_SIZE && n > 0; i++) {
      if (!this.slots[i]) {
        const take = Math.min(n, def.max);
        this.slots[i] = { id, n: take };
        n -= take;
      }
    }
    return n;
  }

  count(id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.n;
    return n;
  }

  /* Remove n of item id; returns true if fully removed. */
  consume(id, n) {
    if (this.count(id) < n) return false;
    for (let i = 0; i < INV_SIZE && n > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const take = Math.min(n, s.n);
        s.n -= take; n -= take;
        if (s.n <= 0) this.slots[i] = null;
      }
    }
    return true;
  }

  /* Take one item from the selected stack (for placement). */
  useSelected() {
    const s = this.slots[this.sel];
    if (!s) return null;
    s.n--;
    const id = s.id;
    if (s.n <= 0) this.slots[this.sel] = null;
    return id;
  }

  totalDefense() {
    let d = 0;
    for (const k of ["head", "chest", "legs"]) {
      const s = this.armor[k];
      if (s && ITEMS[s.id]) d += (ITEMS[s.id].def || 0) + (s.ench && s.ench.def || 0);
    }
    for (const k of ["ring", "back", "feet"]) {
      const s = this.accessory[k];
      if (s && ITEMS[s.id]) d += ITEMS[s.id].def || 0;
    }
    return d;
  }

  /* Movement/utility perks granted by equipped accessories -- read fresh
     each frame by Player.update() (three slot lookups, cheap enough that
     caching on equip-change isn't worth the extra bookkeeping). */
  accessoryPerks() {
    const p = { doubleJump: false, glide: false, dash: false, grapple: false, speedMult: 1, jumpBoost: 0, regenBonus: 0 };
    for (const k of ["ring", "back", "feet"]) {
      const s = this.accessory[k];
      const d = s && ITEMS[s.id];
      if (!d) continue;
      if (d.doubleJump) p.doubleJump = true;
      if (d.glide) p.glide = true;
      if (d.dash) p.dash = true;
      if (d.grapple) p.grapple = true;
      if (d.speedMult) p.speedMult *= d.speedMult;
      if (d.jumpBoost) p.jumpBoost += d.jumpBoost;
      if (d.regen) p.regenBonus += d.regen;
    }
    return p;
  }

  /* ---------------------------------------------------------- crafting */
  canCraft(recipe, stations) {
    if (recipe.station && !stations.has(recipe.station)) return false;
    for (const [id, n] of recipe.ing) if (this.count(id) < n) return false;
    return true;
  }

  craft(recipe, stations) {
    if (!this.canCraft(recipe, stations)) return false;
    /* verify output fits before consuming */
    const def = ITEMS[recipe.out];
    let space = 0;
    for (const s of this.slots) {
      if (!s) space += def.max;
      else if (s.id === recipe.out) space += def.max - s.n;
    }
    if (space < recipe.n) return false;
    for (const [id, n] of recipe.ing) this.consume(id, n);
    this.add(recipe.out, recipe.n);
    return true;
  }

  visibleRecipes(stations) {
    /* show recipes whose station is available; craftable ones first */
    const rows = [];
    for (const r of RECIPES) {
      if (r.station && !stations.has(r.station)) continue;
      rows.push({ recipe: r, can: this.canCraft(r, stations) });
    }
    rows.sort((a, b) => (b.can ? 1 : 0) - (a.can ? 1 : 0));
    return rows;
  }

  /* ------------------------------------------------------------- save */
  serialize() {
    return {
      slots: this.slots,
      armor: this.armor,
      accessory: this.accessory,
      sel: this.sel,
    };
  }

  static from(data) {
    const inv = new Inventory();
    if (data) {
      if (Array.isArray(data.slots)) {
        for (let i = 0; i < INV_SIZE; i++) {
          const s = data.slots[i];
          inv.slots[i] = s && ITEMS[s.id] && s.n > 0 ? { id: s.id, n: s.n } : null;
        }
      }
      if (data.armor) {
        for (const k of ["head", "chest", "legs"]) {
          const s = data.armor[k];
          inv.armor[k] = s && ITEMS[s.id] ? { id: s.id, n: 1 } : null;
        }
      }
      /* older saves predate accessories -- data.accessory is simply absent,
         inv.accessory keeps the all-null default from the constructor */
      if (data.accessory) {
        for (const k of ["ring", "back", "feet"]) {
          const s = data.accessory[k];
          inv.accessory[k] = s && ITEMS[s.id] ? { id: s.id, n: 1 } : null;
        }
      }
      inv.sel = Math.min(9, Math.max(0, data.sel | 0));
    }
    return inv;
  }
}

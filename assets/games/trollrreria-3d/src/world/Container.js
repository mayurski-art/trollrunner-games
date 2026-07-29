import { MAX_STACK } from './blocks.js';

// Pure stack-slot helpers shared by the player inventory and chests, so both
// use identical stacking/overflow rules without duplicating the logic.
export function addToSlots(slots, id, amount) {
  let remaining = amount;
  for (let i = 0; i < slots.length && remaining > 0; i++) {
    const slot = slots[i];
    if (slot && slot.id === id && slot.count < MAX_STACK) {
      const take = Math.min(remaining, MAX_STACK - slot.count);
      slot.count += take;
      remaining -= take;
    }
  }
  for (let i = 0; i < slots.length && remaining > 0; i++) {
    if (!slots[i]) {
      const take = Math.min(remaining, MAX_STACK);
      slots[i] = { id, count: take };
      remaining -= take;
    }
  }
  return remaining;
}

export function countInSlots(slots, id) {
  let total = 0;
  for (const slot of slots) if (slot && slot.id === id) total += slot.count;
  return total;
}

export function removeFromSlots(slots, id, amount) {
  let remaining = amount;
  for (let i = 0; i < slots.length && remaining > 0; i++) {
    const slot = slots[i];
    if (slot && slot.id === id) {
      const take = Math.min(remaining, slot.count);
      slot.count -= take;
      remaining -= take;
      if (slot.count <= 0) slots[i] = null;
    }
  }
  return remaining === 0;
}

// Moves the whole stack at fromSlots[index] into toSlots (first matching
// stack, else first empty slot). Returns true if anything moved.
export function transferSlot(fromSlots, index, toSlots) {
  const slot = fromSlots[index];
  if (!slot) return false;
  const leftover = addToSlots(toSlots, slot.id, slot.count);
  const moved = slot.count - leftover;
  if (moved <= 0) return false;
  fromSlots[index] = leftover > 0 ? { id: slot.id, count: leftover } : null;
  return true;
}

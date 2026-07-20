/* Troll High — cafeteria food bar: pick items, then confirm the order by
   typing your own student ID (feedback-driven addition, not in the
   original design doc). No real ordering backend — the "order" is
   flavor, the ID check is the whole point. */

export const MENU = [
  { id: "pizza", icon: "🍕", name: "Pizza Square" },
  { id: "nuggets", icon: "🍗", name: "Chicken Nuggets" },
  { id: "meatloaf", icon: "🍖", name: "Mystery Meatloaf" },
  { id: "salad", icon: "🥗", name: "Salad Bar" },
  { id: "fries", icon: "🍟", name: "Fries" },
  { id: "milk", icon: "🥛", name: "Chocolate Milk" },
  { id: "apple", icon: "🍎", name: "Apple" },
  { id: "jello", icon: "🍮", name: "Jell-O Cup" },
];

export function normalizeStudentId(raw) {
  return (raw || "").trim().toUpperCase();
}

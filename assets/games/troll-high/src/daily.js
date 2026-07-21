/* Troll High — daily rotating flavor (design doc §21, layer 3: "Living
   MMO" cheap version). Everything here is pure flavor text, deterministic
   from the in-game day index (same clock driving the bell schedule), so
   every player sees the same thing with zero network traffic — no real
   fire drill simulation, no backend, just "today feels different." */

const LUNCH_SPECIALS = [
  { icon: "🍕", name: "Pizza Friday", flavor: "The good kind. Rectangle, extra cheese, gone by 12:15." },
  { icon: "🌮", name: "Taco Day", flavor: "The shells are always a little soggy. Nobody complains." },
  { icon: "🍗", name: "Chicken Nugget Day", flavor: "Shaped like dinosaurs, allegedly." },
  { icon: "🍝", name: "Mystery Casserole", flavor: "Nobody's sure what's in it. Nobody's brave enough to ask." },
  { icon: "🥞", name: "Breakfast for Lunch", flavor: "Pancakes at noon. A rare, beautiful gift." },
  { icon: "🌭", name: "Hot Dog Day", flavor: "Ketchup only, per the sign nobody follows." },
  { icon: "🥪", name: "Sloppy Joe Day", flavor: "You will need at least three napkins." },
  { icon: "🍜", name: "Chicken Noodle Soup", flavor: "Somehow always the exact same temperature: too hot, then cold." },
  { icon: "🧀", name: "Grilled Cheese Day", flavor: "The corner pieces are contraband. Everyone wants them." },
  { icon: "🍚", name: "Rice & Gravy Bowl", flavor: "A cafeteria classic nobody remembers agreeing to love." },
];

const ANNOUNCEMENTS = [
  "Reminder: no gum in class. The rule everyone breaks and nobody enforces.",
  "Yearbook photos are next week — practice your smile.",
  "The library is fining overdue books again. You know who you are.",
  "Lost: one retainer, found near the gym. Ask the nurse.",
  "Congratulations to everyone who made it to the Science Fair semifinals.",
  "The vending machine on the second floor is eating quarters again.",
  "Please stop drawing on the bathroom stalls. (It's not stopping.)",
  "Spirit Week sign-up sheets are on the office bulletin board.",
  "The lost and found is overflowing. Please claim your hoodie.",
  "A reminder that hall passes must be signed, not just held up.",
  "The talent show sign-up sheet has one (1) very ambitious entry so far.",
  "Someone left a half-eaten sandwich in the library. Again.",
  "The AC in the science lab is 'being worked on.' It has always been worked on.",
  "Report card pickup is next Thursday. Practice your excuses.",
];

const DAILY_EVENTS = [
  "🔔 Fire drill today — don't be surprised by the alarm.",
  "🐹 Someone's class hamster escaped. Keep an eye out.",
  "🥎 Extra recess today — the good kind of chaos.",
  "📚 Book Fair is in the library all week.",
  "🎭 Talent show sign-ups are open in the auditorium.",
  "❄️ It's unseasonably cold today. Someone's definitely forgotten a jacket.",
  "🖍️ Picture Day retakes are happening in the gym.",
  "🎒 New kid started today — say hi if you see them.",
  "🚌 Bus 12 was late again. Everyone has a theory why.",
  "🧯 The smoke detector in the science lab went off for no reason. Again.",
  "🏀 Pep rally after lunch — try not to get trampled.",
  "🎨 Someone's art project is drying in the hallway. Do not touch it.",
];

/* Deterministic pseudo-random pick from a day index — a small
   multiplicative hash so consecutive days don't cycle in obvious order,
   and a salt so the three pools don't all land in sync. */
function pickForDay(pool, dayIndex, salt) {
  const h = Math.imul(dayIndex + salt, 2654435761) >>> 0;
  return pool[h % pool.length];
}

// Exported separately so events.js's real-calendar "pizza-friday" event
// (every real Friday) can force this exact special regardless of the
// in-game day's own rotation — the two systems are deterministic from
// different clocks (real date vs. in-game day index) and can disagree.
export const PIZZA_FRIDAY_SPECIAL = LUNCH_SPECIALS[0];

export function todaysLunch(dayIndex) { return pickForDay(LUNCH_SPECIALS, dayIndex, 0); }
export function todaysAnnouncement(dayIndex) { return pickForDay(ANNOUNCEMENTS, dayIndex, 17); }
export function todaysEvent(dayIndex) { return pickForDay(DAILY_EVENTS, dayIndex, 41); }

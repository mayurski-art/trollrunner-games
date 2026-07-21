/* Troll High — event engine (design doc §12/§21 Phase 10). Deterministic
   from the REAL calendar date (not the in-game day index — these are
   meant to feel tied to the actual world, the way a real school's
   calendar would), so every player sees the same event on the same real
   day with zero network traffic, same trick as daily.js and clock.js.

   Only one special event is "active" at a time — priority order below —
   surfaced as a banner (schedule overlay) plus, for the two with real
   visual weight, a tint layer in the renderer. */

export const EVENTS = {
  halloween: { icon: "🎃", name: "Halloween", tint: "rgba(255, 120, 20, 0.16)" },
  "snow-day": { icon: "❄️", name: "Snow Day", tint: "rgba(200, 220, 255, 0.20)" },
  dance: { icon: "🪩", name: "School Dance", tint: null },
  "spirit-week": { icon: "📣", name: "Spirit Week", tint: null },
  "book-fair": { icon: "📚", name: "Book Fair", tint: null },
  "picture-day": { icon: "📸", name: "Picture Day", tint: null },
  "pacer-day": { icon: "🏃", name: "PACER Day", tint: null },
  "pizza-friday": { icon: "🍕", name: "Pizza Friday", tint: null },
};

/* date: a real Date (defaults to now — parameterized for tests). Returns
   an event id from EVENTS, or null on an ordinary day. */
export function activeEvent(date = new Date()) {
  const month = date.getMonth(); // 0-11
  const day = date.getDate();    // 1-31
  const weekday = date.getDay(); // 0=Sun..6=Sat

  if (month === 9 && day >= 25) return "halloween"; // Oct 25-31
  if ((month === 11 && day >= 15) || month === 0 || (month === 1 && day <= 15)) {
    // Dec 15 - Feb 15: a deterministic "does it snow today" pseudo-roll,
    // same for every player (not truly random — a stable hash of the
    // date), roughly one day in seven.
    const seed = date.getFullYear() * 372 + month * 31 + day;
    if ((Math.imul(seed, 2654435761) >>> 0) % 7 === 0) return "snow-day";
  }
  if (day >= 22 && day <= 28 && weekday === 5) return "dance"; // last Friday of the month
  if (day >= 1 && day <= 5) return "spirit-week";
  if (day >= 8 && day <= 12) return "book-fair";
  if (day === 15) return "picture-day";
  if (day === 20) return "pacer-day";
  if (weekday === 5) return "pizza-friday";
  return null;
}

export function eventInfo(id) {
  return id ? EVENTS[id] : null;
}

/* Troll High — the deterministic world clock.
   1 real hour = 1 school day, anchored to wall-clock UTC, so every client
   on earth agrees on the time with zero network traffic. NPC routines,
   ambient audio and lighting all read from here. */

const DAY_MS = 60 * 60 * 1000; // one real hour

const PERIODS = [
  //  [start in-game hour, label]
  [0, "Night"], [6, "Sunrise"], [7, "Homeroom"], [8, "Period 1"],
  [9, "Period 2"], [10, "Period 3"], [11, "Period 4"], [12, "Lunch"],
  [13, "Period 5"], [14, "Period 6"], [15, "After school"],
  [18, "Evening"], [21, "Night"],
];

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function now() {
  const t = Date.now();
  const dayIndex = Math.floor(t / DAY_MS);
  const frac = (t % DAY_MS) / DAY_MS;    // 0..1 through the school day
  const minutes = Math.floor(frac * 1440);
  const hour = Math.floor(minutes / 60);
  const min = minutes % 60;

  let period = PERIODS[0][1], periodStartHour = PERIODS[0][0];
  for (const [h, label] of PERIODS) if (hour >= h) { period = label; periodStartHour = h; }

  return {
    dayIndex,
    weekday: WEEKDAYS[dayIndex % 7],
    hour, min, frac,
    period,
    periodStartHour,
    label: `${WEEKDAYS[dayIndex % 7]} · ${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")} · ${period}`,
  };
}

/* Real ms elapsed since the current period began — a pure function of
   wall-clock time, so every client agrees without any network sync. Used
   to give each new period a brief "passing period" bustle window. */
export function msSincePeriodStart() {
  const { hour, min, periodStartHour } = now();
  const elapsedGameMin = (hour - periodStartHour) * 60 + min;
  return elapsedGameMin * (DAY_MS / 1440);
}

const PASSING_PERIOD_MS = 30 * 1000; // first 30 real seconds of a new period
export function isPassingPeriod() {
  return msSincePeriodStart() < PASSING_PERIOD_MS;
}

/* 0 = full day, 1 = deep night. Smooth ramps at dawn (5–7) and dusk (18–21). */
export function nightAmount() {
  const { hour, min } = now();
  const h = hour + min / 60;
  if (h >= 7 && h < 18) return 0;
  if (h >= 5 && h < 7) return (7 - h) / 2;
  if (h >= 18 && h < 21) return (h - 18) / 3;
  return 1;
}

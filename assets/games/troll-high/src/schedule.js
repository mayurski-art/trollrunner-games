/* Troll High — class schedule, electives, and daily tasks. Ties into the
   existing bell-period clock (clock.js) rather than inventing a second
   time system. */

export const ELECTIVES = [
  { id: "art", label: "Art Class", zoneId: "art-room", zoneName: "Art Room" },
  { id: "band", label: "Band", zoneId: "music-room", zoneName: "Music Room" },
  { id: "study", label: "AP Study Hall", zoneId: "library", zoneName: "Library" },
  { id: "drama", label: "Drama Club", zoneId: "auditorium", zoneName: "Auditorium" },
];

const CORE_PERIODS = [
  { period: "Homeroom", subject: "Homeroom", zoneId: "classroom-3b", zoneName: "Room 3B" },
  { period: "Period 1", subject: "Math", zoneId: "classroom-3c", zoneName: "Room 5A" },
  { period: "Period 2", subject: "AP Science", zoneId: "science-lab", zoneName: "Science Lab" },
  { period: "Period 3", subject: "English", zoneId: "classroom-3d", zoneName: "Room 7A" },
  { period: "Period 4", subject: "AP Computer Science", zoneId: "computer-lab", zoneName: "Computer Lab" },
  { period: "Lunch", subject: "Lunch", zoneId: "cafeteria", zoneName: "Cafeteria" },
  { period: "Period 5", subject: "P.E.", zoneId: "gym", zoneName: "Gym" },
];

export function buildSchedule(electiveId) {
  const elective = ELECTIVES.find(e => e.id === electiveId) || ELECTIVES[2];
  return [
    ...CORE_PERIODS,
    { period: "Period 6", subject: elective.label, zoneId: elective.zoneId, zoneName: elective.zoneName },
  ];
}

export const DAILY_TASKS = [
  { id: "memory", label: "Find a memory around campus" },
  { id: "minigame", label: "Play a recess game" },
  { id: "lunch", label: "Grab lunch at the cafeteria" },
  { id: "map", label: "Check the campus map" },
];

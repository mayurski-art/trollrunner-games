/* Troll High — student profile: a cosmetic in-game student ID (separate
   from the real TrollrunnerAccounts identity, generated once per player
   and persisted alongside the save), plus the profile card renderer. */

const ID_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O — avoids look-alikes

export function genStudentId() {
  const letter = () => ID_LETTERS[Math.floor(Math.random() * ID_LETTERS.length)];
  const digit = () => Math.floor(Math.random() * 10);
  return `${letter()}${letter()}-${digit()}${digit()}${digit()}${digit()}${digit()}${digit()}`;
}

export function renderProfile(dom, { name, studentId, enrolledAt, memoriesFound, highScores, minigameInfo, stats, dailyLife }) {
  dom.name.textContent = name;
  dom.id.textContent = `Student ID: ${studentId}`;
  const days = Math.max(0, Math.floor((Date.now() - enrolledAt) / 86400000));
  dom.enrolled.textContent = days === 0 ? "Enrolled today" : `Enrolled ${days} day${days === 1 ? "" : "s"} ago`;
  dom.memories.textContent = String(memoriesFound);

  if (dom.dailyLife && dailyLife) {
    const bits = [];
    if (dailyLife.favoriteZone) bits.push(`Usually found in: ${dailyLife.favoriteZone}`);
    if (dailyLife.hasLocker) bits.push("Has a locker");
    if (dailyLife.hasBench) bits.push("Has a bench");
    if (dailyLife.club) bits.push(`Club: ${dailyLife.club.name}${dailyLife.club.founded ? " (founder)" : ""}`);
    dom.dailyLife.textContent = bits.join(" · ");
  }

  if (dom.roomsExplored) dom.roomsExplored.textContent = `${stats.roomsExplored} / ${stats.totalRooms}`;
  if (dom.daysAttended) dom.daysAttended.textContent = String(stats.daysAttended);
  if (dom.lunchesBought) dom.lunchesBought.textContent = String(stats.lunchesBought);
  if (dom.tradesCompleted) dom.tradesCompleted.textContent = String(stats.tradesCompleted);
  if (dom.giftsGiven) dom.giftsGiven.textContent = String(stats.giftsGiven);
  if (dom.giftsReceived) dom.giftsReceived.textContent = String(stats.giftsReceived);
  if (dom.cardsCollected) dom.cardsCollected.textContent = `${stats.cardsCollected} / ${stats.totalCards}`;

  dom.scores.innerHTML = "";
  const kinds = Object.keys(highScores || {});
  if (kinds.length === 0) {
    const li = document.createElement("li");
    li.className = "th-profile-empty";
    li.textContent = "No recess games played yet";
    dom.scores.appendChild(li);
    return;
  }
  for (const kind of kinds) {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = minigameInfo(kind).title;
    const score = document.createElement("b");
    score.textContent = String(highScores[kind]);
    li.append(label, score);
    dom.scores.appendChild(li);
  }
}

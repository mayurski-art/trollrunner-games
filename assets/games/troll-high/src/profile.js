/* Troll High — student profile: a cosmetic in-game student ID (separate
   from the real TrollrunnerAccounts identity, generated once per player
   and persisted alongside the save), plus the profile card renderer. */

const ID_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O — avoids look-alikes

export function genStudentId() {
  const letter = () => ID_LETTERS[Math.floor(Math.random() * ID_LETTERS.length)];
  const digit = () => Math.floor(Math.random() * 10);
  return `${letter()}${letter()}-${digit()}${digit()}${digit()}${digit()}${digit()}${digit()}`;
}

export function renderProfile(dom, { name, studentId, enrolledAt, memoriesFound, highScores, minigameInfo }) {
  dom.name.textContent = name;
  dom.id.textContent = `Student ID: ${studentId}`;
  const days = Math.max(0, Math.floor((Date.now() - enrolledAt) / 86400000));
  dom.enrolled.textContent = days === 0 ? "Enrolled today" : `Enrolled ${days} day${days === 1 ? "" : "s"} ago`;
  dom.memories.textContent = String(memoriesFound);

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

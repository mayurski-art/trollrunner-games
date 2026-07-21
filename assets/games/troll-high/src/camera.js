/* Troll High — disposable camera / yearbook. Captures the actual current
   game view (the real canvas, not a mock) and uploads it to the
   troll-high-photos bucket (docs/troll_high_yearbook.sql) under the
   player's own folder. The photo LIST (path, public URL, when, where)
   lives in the normal troll_game_saves row like everything else here —
   only the image bytes need real storage. */

const BUCKET = "troll-high-photos";
const MAX_PHOTOS = 12; // "disposable camera" — a limited roll, not infinite

function client() {
  return window.TrollrunnerAccounts?.getClient?.();
}

/* Resolves { ok: true, photo } on success, or { ok: false, reason } —
   reason is shown to the player, so keep it short and human. Doesn't
   throw: a missing bucket (SQL not run yet) or a network hiccup are both
   just "couldn't take that photo right now," not a crash. */
export async function capturePhoto(canvas, userId, { zoneId, zoneName }) {
  const sb = client();
  if (!sb) return { ok: false, reason: "Not signed in." };

  let blob;
  try {
    blob = await new Promise((resolve, reject) => {
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error("empty canvas"))), "image/jpeg", 0.85);
    });
  } catch (e) {
    return { ok: false, reason: "Couldn't capture the screen." };
  }

  const path = `${userId}/${Date.now()}.jpg`;
  try {
    const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg" });
    if (error) return { ok: false, reason: "Couldn't save that photo — try again in a moment." };
  } catch (e) {
    return { ok: false, reason: "Couldn't save that photo — try again in a moment." };
  }

  const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
  return {
    ok: true,
    photo: { path, url: data.publicUrl, takenAt: Date.now(), zoneId, zoneName },
  };
}

export function addPhotoToRoll(photos, photo) {
  const next = [...photos, photo];
  // Oldest exposures go first when the roll is full — a disposable camera
  // doesn't let you pick which shots to keep.
  return next.length > MAX_PHOTOS ? next.slice(next.length - MAX_PHOTOS) : next;
}

export { MAX_PHOTOS };

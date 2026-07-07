/* Trollrreria — the $TROLL store: real Solana payments through the site's
   one live payment lib (window.TrollPay, same one Meme Metro's revive and
   the Finance tip jar use). Two kinds of purchase, both player-pays-only:

     - Cosmetic skins: a CSS hue/saturation tint applied to the player's
       rig, same trick every NPC in this game already uses to look distinct
       from a plain reskin. Bought once, owned forever, free to re-equip.
     - Battle revive: get back up where you died instead of walking back
       from spawn. Priced from the same TROLL_PAY_CONFIG.REVIVE_PRICE_USD
       every other game's revive uses.

   Deliberately NOT built here: payouts, prizes, or any way to earn real
   $TROLL from playing -- see docs/PART2-SYSTEMS.md. This is spend-only,
   consistent with the rest of the site. */

export const SKINS = {
  golden: { name: "Golden Troll", tint: "sepia(0.6) saturate(2.4) hue-rotate(-10deg) brightness(1.15)", priceUsd: 1.99 },
  shadow: { name: "Shadow Troll", tint: "brightness(0.35) saturate(1.4) hue-rotate(250deg)", priceUsd: 1.99 },
  radioactive: { name: "Radioactive Troll", tint: "hue-rotate(85deg) saturate(3) brightness(1.2)", priceUsd: 1.99 },
  chromeDoge: { name: "Chrome Doge Fit", tint: "grayscale(0.7) sepia(0.3) saturate(1.6) hue-rotate(180deg) brightness(1.1)", priceUsd: 2.99 },
};

function TP() { return window.TrollPay; }

function ownedSkins(game) {
  if (!Array.isArray(game.flags.ownedSkins)) game.flags.ownedSkins = [];
  return game.flags.ownedSkins;
}

export function isOwned(game, skinId) {
  return ownedSkins(game).includes(skinId);
}

function logSpend(token, amount, wallet, signature, purpose) {
  const acct = window.TrollrunnerAccounts;
  if (acct && acct.logPendingSpend) {
    acct.logPendingSpend({ token, amount, wallet, signature, purpose, feature: "trollrreria" }).catch(() => {});
  }
}

/* Buys + equips a skin. Returns { ok, reason? }. */
export async function buySkin(game, skinId) {
  const skin = SKINS[skinId];
  if (!skin) return { ok: false, reason: "Unknown skin" };
  if (isOwned(game, skinId)) { game.flags.skin = skinId; return { ok: true, alreadyOwned: true }; }
  const tp = TP();
  if (!tp) return { ok: false, reason: "Payments unavailable — reload the page." };
  const token = tp.getToken ? tp.getToken() : "USDC";
  const res = await tp.pay({ amountUsd: skin.priceUsd, token, memo: "TR|trollrreria|skin:" + skinId });
  if (!res.ok) return { ok: false, reason: res.reason || "Payment failed" };
  ownedSkins(game).push(skinId);
  game.flags.skin = skinId;
  logSpend(token, res.total, tp.getWallet ? (tp.getWallet() || {}).address : null, res.txSig, "trollrreria_skin_" + skinId);
  game.ui && game.ui.dirtyHud && game.ui.dirtyHud();
  return { ok: true };
}

export function equipSkin(game, skinId) {
  if (skinId && !isOwned(game, skinId)) return false;
  game.flags.skin = skinId || null;
  return true;
}

/* Pays for a battle revive and brings the player back up where they fell
   (not at spawn/last bed). Returns { ok, reason? }. */
export async function buyRevive(game) {
  const tp = TP();
  if (!tp) return { ok: false, reason: "Payments unavailable — reload the page." };
  const cfg = window.TROLL_PAY_CONFIG || {};
  const priceUsd = cfg.REVIVE_PRICE_USD || 0.69;
  const taxRate = cfg.TAX_RATE || 0;
  const token = tp.getToken ? tp.getToken() : "USDC";
  const res = await tp.pay({ amountUsd: priceUsd, taxRate, token, memo: "TR|trollrreria|revive" });
  if (!res.ok) return { ok: false, reason: res.reason || "Payment failed" };
  logSpend(token, res.total, tp.getWallet ? (tp.getWallet() || {}).address : null, res.txSig, "trollrreria_revive");
  game.reviveInPlace();
  return { ok: true };
}

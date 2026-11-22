// Which mannequin a visitor gets, decided the same way in the page (site/home/home.js starts its download) and in the
// scene (site/room/main.js): phones and small GPUs (owner 2026-11-19: "3D, kualitas rendah") take the lighter one,
// about half the triangles (scripts/mannequin.mjs). Each URL carries its file's hash (scripts/build-room.mjs).
/* global __MANNEQUIN_VERSION__, __MANNEQUIN_LO_VERSION__ */

/** Touch screens, windows under 760 px and 4 cores or fewer: no bloom, pixel ratio 1, the lighter mannequin. */
export function lowEnd(win = window) {
  const touch = win.matchMedia?.('(pointer: coarse)').matches ?? false;
  return touch || win.innerWidth < 760 || (win.navigator?.hardwareConcurrency || 8) <= 4;
}

export const mannequinUrl = (low) => (low ? `/room/mannequin-lo.glb?v=${__MANNEQUIN_LO_VERSION__}` : `/room/mannequin.glb?v=${__MANNEQUIN_VERSION__}`);

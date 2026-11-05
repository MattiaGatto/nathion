// One recorder/player owns browser audio across chat and workflow views.
let active: { owner: symbol; stop: () => void } | null = null;

export function claimAudio(owner: symbol, stop: () => void) {
  if (active && active.owner !== owner) active.stop();
  active = { owner, stop };
}

export function releaseAudio(owner: symbol) {
  if (active?.owner === owner) active = null;
}

export function stopAllAudio() {
  const current = active; active = null; current?.stop();
}

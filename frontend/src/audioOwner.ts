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

export async function openMicrophone(processed = false, stillActive = () => true): Promise<MediaStream> {
  const audio = processed ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true } : true;
  try {
    return await navigator.mediaDevices.getUserMedia({ audio });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      throw new Error("Consenti il microfono per NATHION nelle impostazioni del telefono o del browser.");
    }
    if (name === "NotFoundError") throw new Error("Nessun microfono disponibile.");
    if (!["NotReadableError", "AbortError", "OverconstrainedError"].includes(name) || !stillActive()) throw error;
    await new Promise((resolve) => window.setTimeout(resolve, 300));
    if (!stillActive()) throw error;
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (retryError) {
      if (retryError instanceof DOMException && retryError.name === "NotAllowedError") {
        throw new Error("Consenti il microfono per NATHION nelle impostazioni del telefono o del browser.");
      }
      throw new Error("Microfono non avviato. Chiudi eventuali chiamate o app che lo usano e riprova.");
    }
  }
}

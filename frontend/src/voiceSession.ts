/** Bounded turn detector. Server-side Silero still validates the final audio. */
export class TurnDetector {
  voiced = 0;
  silence = 0;
  elapsed = 0;
  speaking = false;
  reset() { this.voiced = 0; this.silence = 0; this.elapsed = 0; this.speaking = false; }
  feed(rms: number, milliseconds: number, threshold: number): "start" | "end" | null {
    if (!Number.isFinite(rms) || !Number.isFinite(milliseconds) || milliseconds <= 0) return null;
    const voice = rms >= threshold;
    if (!this.speaking) {
      this.voiced = voice ? this.voiced + milliseconds : 0;
      if (this.voiced >= 220) { this.speaking = true; this.elapsed = this.voiced; this.silence = 0; return "start"; }
      return null;
    }
    this.elapsed += milliseconds;
    this.silence = voice ? 0 : this.silence + milliseconds;
    if (this.silence >= 900 || this.elapsed >= 54000) { this.reset(); return "end"; }
    return null;
  }
}

export function wavAudio(frames: Float32Array[], sampleRate: number): Blob {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error("Frequenza audio non supportata");
  const length = frames.reduce((sum, frame) => sum + frame.length, 0);
  if (!length || length / sampleRate > 56) throw new Error("Durata audio non valida");
  const source = new Float32Array(length);
  let offset = 0;
  for (const frame of frames) { source.set(frame, offset); offset += frame.length; }
  const targetRate = 16000;
  const count = Math.floor(length * targetRate / sampleRate);
  const data = new ArrayBuffer(44 + count * 2);
  const view = new DataView(data);
  const text = (at: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)); };
  text(0, "RIFF"); view.setUint32(4, 36 + count * 2, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, targetRate, true); view.setUint32(28, targetRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * sampleRate / targetRate), end = Math.max(start + 1, Math.floor((i + 1) * sampleRate / targetRate));
    let sum = 0;
    for (let j = start; j < Math.min(end, length); j++) sum += source[j];
    const sample = Math.max(-1, Math.min(1, sum / (end - start)));
    view.setInt16(44 + i * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
  }
  return new Blob([data], { type: "audio/wav" });
}

/** Only complete phrases are spoken before the model finishes. */
export function nextPhrase(text: string, done: boolean): { phrase: string; consumed: number } | null {
  if (!text.trim()) return null;
  const match = /[.!?](?:\s|$)/.exec(text);
  let end = match ? match.index + match[0].length : done ? text.length : 0;
  if (!end && text.length > 280) { const space = text.lastIndexOf(" ", 280); end = space > 0 ? space : 280; }
  if (!end) return null;
  if (end > 280) { const space = text.lastIndexOf(" ", 280); end = space > 0 ? space : 280; }
  return { phrase: text.slice(0, end).trim(), consumed: end };
}

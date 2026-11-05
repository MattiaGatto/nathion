import test from "node:test";
import assert from "node:assert/strict";
import { TurnDetector, wavAudio, nextPhrase } from "../src/voiceSession.ts";

test("brief clicks and silence do not send a voice turn", () => {
  const detector = new TurnDetector();
  for (let i = 0; i < 100; i++) {
    assert.equal(detector.feed(0.002, 40, 0.018), null);
    assert.equal(detector.feed(0.08, 40, 0.018), null);
  }
  assert.equal(detector.speaking, false);
});
test("speech starts after sustained energy and ends after a pause", () => {
  const detector = new TurnDetector();
  for (let i = 0; i < 5; i++) assert.equal(detector.feed(0.04, 40, 0.018), null);
  assert.equal(detector.feed(0.04, 40, 0.018), "start");
  for (let i = 0; i < 22; i++) assert.equal(detector.feed(0, 40, 0.018), null);
  assert.equal(detector.feed(0, 40, 0.018), "end");
  assert.equal(detector.speaking, false);
});
test("long speech is bounded and the next turn can begin", () => {
  const detector = new TurnDetector();
  let ended = false;
  for (let i = 0; i < 1400; i++) if (detector.feed(0.04, 40, 0.018) === "end") { ended = true; break; }
  assert.equal(ended, true);
  assert.equal(detector.feed(NaN, 40, 0.018), null);
  detector.reset();
  assert.equal(detector.elapsed, 0);
});
test("capture is resampled to a valid mono 16 kHz PCM WAV", async () => {
  const samples = new Float32Array(48000);
  for (let i = 0; i < samples.length; i++) samples[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / 48000);
  const blob = wavAudio([samples.slice(0, 12000), samples.slice(12000)], 48000);
  const data = await blob.arrayBuffer(); const view = new DataView(data);
  assert.equal(blob.type, "audio/wav"); assert.equal(data.byteLength, 32044);
  assert.equal(view.getUint32(24, true), 16000); assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(40, true), 32000);
  assert.ok(Math.abs(view.getInt16(44 + 18 * 2, true)) > 100);
});
test("invalid rates, empty input and oversized recordings are rejected", () => {
  assert.throws(() => wavAudio([], 48000));
  assert.throws(() => wavAudio([new Float32Array(1)], 0));
  assert.throws(() => wavAudio([new Float32Array(48000 * 57)], 48000));
});
test("streamed phrases preserve all text and bound each audio request", () => {
  assert.equal(nextPhrase("Risposta ancora incompleta", false), null);
  assert.deepEqual(nextPhrase("Ciao. Come stai?", false), { phrase: "Ciao.", consumed: 6 });
  assert.deepEqual(nextPhrase("Fine", true), { phrase: "Fine", consumed: 4 });
  let remaining = "Parole ripetute ".repeat(100); const words = [];
  while (remaining.trim()) { const part = nextPhrase(remaining, true); assert.ok(part); assert.ok(part.phrase.length <= 280); words.push(part.phrase); remaining = remaining.slice(part.consumed); }
  assert.equal(words.join(" ").replace(/\s+/g, " ").trim(), "Parole ripetute ".repeat(100).trim());
});

test("long unbroken output cannot create negative offsets or oversized phrases", () => {
  assert.deepEqual(nextPhrase("a".repeat(600), false), { phrase: "a".repeat(280), consumed: 280 });
});

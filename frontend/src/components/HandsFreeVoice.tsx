import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { claimAudio, releaseAudio } from "../audioOwner";
import { TurnDetector, wavAudio, nextPhrase } from "../voiceSession";

interface Props { connected: boolean; response: { content: string; done: boolean } | null; onSend: (text: string) => boolean; onInterrupt: () => void; }
export function HandsFreeVoice(props: Props) {
  const latest = useRef(props); latest.current = props;
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [transcript, setTranscript] = useState("");
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [bargeIn, setBargeIn] = useState(false);
  const interruptible = useRef(false); interruptible.current = bargeIn;
  const [threshold, setThreshold] = useState(0.018);
  const thresholdRef = useRef(threshold); thresholdRef.current = threshold;
  const owner = useRef(Symbol("conversation"));
  const running = useRef(false);
  const generation = useRef(0);
  const resources = useRef<{ input: MediaStream; context: AudioContext; capture: AudioWorkletNode } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const audioUrl = useRef("");
  const queue = useRef<string[]>([]);
  const playing = useRef(false);
  const expected = useRef(false);
  const cursor = useRef(0);
  const playbackGeneration = useRef(0);
  const idleTimeout = useRef<number>();
  const transcriptReceived = useRef(false);
  function resetIdle() {
    clearTimeout(idleTimeout.current);
    idleTimeout.current = window.setTimeout(() => {
      stop();
      setStatus(transcriptReceived.current
        ? "Microfono chiuso dopo 20 secondi di inattività."
        : "Microfono chiuso dopo 20 secondi. Nessuna frase riconosciuta.");
    }, 20_000);
  }

  function stopPlayback() {
    playbackGeneration.current++;
    controller.current?.abort(); controller.current = null;
    if (audio.current) { audio.current.onended = null; audio.current.onerror = null; audio.current.pause(); }
    audio.current = null;
    if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    audioUrl.current = ""; queue.current = []; playing.current = false;
  }
  function stop() {
    clearTimeout(idleTimeout.current);
    running.current = false; generation.current++; expected.current = false; cursor.current = 0;
    stopPlayback();
    const current = resources.current; resources.current = null;
    if (current) { current.capture.port.onmessage = null; current.capture.disconnect(); current.input.getTracks().forEach((track) => track.stop()); void current.context.close().catch(() => {}); }
    releaseAudio(owner.current); setActive(false); setStatus("");
  }
  function fail(value: unknown) { stop(); setError(value instanceof Error ? value.message : "Sessione vocale interrotta"); }
  useEffect(() => {
    const hidden = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", hidden);
    return () => { document.removeEventListener("visibilitychange", hidden); stop(); };
  }, []);
  useEffect(() => { if (!props.connected) stop(); }, [props.connected]);

  async function playQueue() {
    if (!running.current || playing.current) return;
    if (!queue.current.length) {
      if (!expected.current) {
        setStatus("Risposta terminata · ti ascolto…");
        resetIdle();
      }
      return;
    }
    playing.current = true;
    const current = playbackGeneration.current;
    try {
      setStatus("Preparazione voce…");
      const abort = new AbortController(); controller.current = abort;
      const blob = await api.speak(queue.current.shift()!, abort.signal);
      if (!running.current || current !== playbackGeneration.current) return;
      audioUrl.current = URL.createObjectURL(blob);
      const player = new Audio(audioUrl.current); audio.current = player;
      player.onended = () => {
        if (current !== playbackGeneration.current) return;
        if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
        audioUrl.current = ""; audio.current = null; playing.current = false;
        void playQueue();
      };
      player.onerror = () => fail(new Error("Riproduzione vocale non riuscita"));
      await player.play();
      if (current === playbackGeneration.current) setStatus("NATHION parla · microfono attivo");
    } catch (e) { if (running.current && current === playbackGeneration.current) fail(e); }
  }

  useEffect(() => {
    if (!running.current || !expected.current) return;
    if (!props.response) { expected.current = false; stopPlayback(); setStatus("Risposta interrotta · ti ascolto…"); resetIdle(); return; }
    if (props.response.content.length < cursor.current) cursor.current = 0;
    let remaining = props.response.content.slice(cursor.current);
    let part;
    while ((part = nextPhrase(remaining, props.response.done))) {
      cursor.current += part.consumed; remaining = remaining.slice(part.consumed);
      if (part.phrase) queue.current.push(part.phrase);
      if (queue.current.length > 40) { fail(new Error("Risposta troppo lunga per la coda vocale")); return; }
    }
    if (props.response.done) expected.current = false;
    void playQueue();
  }, [props.response]);

  async function start() {
    stop(); transcriptReceived.current = false; setMicrophoneLevel(0); setError(""); setTranscript(""); setStatus("Accesso al microfono…");
    claimAudio(owner.current, stop); running.current = true; setActive(true);
    const current = generation.current;
    let input: MediaStream | null = null;
    let context: AudioContext | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) throw new Error("Usa un browser aggiornato su HTTPS o localhost.");
      const availability = await api.voiceStatus();
      if (!availability.enabled || !availability.whisper_model_present || !availability.piper_model_present) throw new Error("Motore vocale non pronto. Controlla i modelli locali.");
      if (!running.current || current !== generation.current) return;
      input = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (!running.current || current !== generation.current) { input.getTracks().forEach((track) => track.stop()); return; }
      context = new AudioContext(); await context.resume(); await context.audioWorklet.addModule("/voice-capture.js");
      if (!running.current || current !== generation.current) { input.getTracks().forEach((track) => track.stop()); await context.close(); return; }
      const source = context.createMediaStreamSource(input);
      const capture = new AudioWorkletNode(context, "nathion-capture");
      // Worklet output is silent; connecting it keeps capture processing live.
      source.connect(capture); capture.connect(context.destination);
      resources.current = { input, context, capture };
      const detector = new TurnDetector();
      let preRoll: Float32Array[] = [], frames: Float32Array[] = [];
      let processing = false;
      let lastLevelUpdate = 0;
      const rate = context.sampleRate;
      capture.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (!running.current || current !== generation.current || processing) return;
        const frame = event.data;
        const milliseconds = frame.length * 1000 / rate;
        const speakingBack = playing.current || Boolean(latest.current.response && !latest.current.response.done);
        if (speakingBack && !interruptible.current) { detector.reset(); frames = []; preRoll = []; return; }
        const rms = Math.sqrt(frame.reduce((sum, sample) => sum + sample * sample, 0) / frame.length);
        const now = performance.now();
        if (now - lastLevelUpdate >= 150) {
          setMicrophoneLevel(rms);
          lastLevelUpdate = now;
        }
        if (!detector.speaking) {
          preRoll.push(frame);
          while (preRoll.length * milliseconds > 500) preRoll.shift();
        } else frames.push(frame);
        const action = detector.feed(rms, milliseconds, thresholdRef.current);
        if (action === "start") {
          clearTimeout(idleTimeout.current);
          frames = [...preRoll]; preRoll = [];
          if (speakingBack) { expected.current = false; stopPlayback(); latest.current.onInterrupt(); }
          setStatus("Ti ascolto · termina la frase con una pausa…");
        } else if (action === "end") {
          const recording = frames; frames = []; preRoll = []; processing = true; setStatus("Trascrizione locale…");
          const abort = new AbortController(); controller.current = abort;
          api.transcribe(wavAudio(recording, rate), abort.signal).then(({ text }) => {
            if (!running.current || current !== generation.current) return;
            setTranscript(text);
            if (text.trim()) {
              transcriptReceived.current = true;
              cursor.current = 0; expected.current = true;
              if (!latest.current.onSend(text)) { expected.current = false; throw new Error("La chat non è pronta. Riprova dopo la risposta."); }
              setStatus("Frase inviata alla chat. Attendo la risposta…");
            } else {
              setStatus("Nessuna parola riconosciuta. Prova a parlare più vicino al microfono.");
              resetIdle();
            }
          }).catch((e) => { if (running.current && current === generation.current) fail(e); })
            .finally(() => { processing = false; detector.reset(); });
        }
      };
      input.getTracks().forEach((track) => { track.onended = () => { if (running.current) fail(new Error("Il dispositivo ha interrotto il microfono")); }; });
      resetIdle();
      setStatus("Ti ascolto…");
    } catch (e) {
      if (resources.current?.context !== context) { input?.getTracks().forEach((track) => track.stop()); void context?.close().catch(() => {}); }
      if (current === generation.current) fail(e);
    }
  }
  return <section className="mb-3 space-y-2 rounded-lg border border-nathion-border p-3 text-xs" aria-label="Conversazione vocale"><div className="flex flex-wrap items-center gap-3"><button className="rounded-lg border border-nathion-border px-3 py-2 disabled:opacity-40" disabled={!props.connected && !active} onClick={() => active ? (stop(), latest.current.onInterrupt()) : void start()}>{active ? "Termina conversazione vocale" : "Avvia conversazione vocale"}</button><span role="status">{status}</span></div><p className="text-nathion-muted">Le frasi vengono inviate dopo una pausa, solo durante la sessione attiva.</p><details><summary className="cursor-pointer text-nathion-muted">Opzioni vocali</summary><p className="my-2 text-nathion-muted">La sessione termina quando lasci la pagina o dopo 20 secondi in ascolto senza parlare. La trascrizione e la risposta hanno il tempo di completarsi.</p><label><input type="checkbox" checked={bargeIn} onChange={(e) => setBargeIn(e.target.checked)} /> Interrompi parlando (usa cuffie per evitare l’eco)</label><label className="ml-3">Soglia microfono <input aria-label="Soglia microfono" type="range" min={0.008} max={0.08} step={0.002} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} /></label></details>{active && <label className="flex items-center gap-2 text-nathion-muted">Segnale microfono<meter min={0} max={Math.max(0.08, microphoneLevel)} low={threshold} value={microphoneLevel} /></label>}
    {transcript && <p aria-live="polite" aria-label="Ultima frase riconosciuta">Tu: {transcript}</p>}{error && <p role="alert" className="text-red-300">{error}</p>}</section>;
}

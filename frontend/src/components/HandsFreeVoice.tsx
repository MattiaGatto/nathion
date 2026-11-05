import { useEffect, useRef, useState } from "react";
import { useAccount } from "./AccessGate";
import { api, workspaceRequest } from "../api/client";
import { claimAudio, releaseAudio } from "../audioOwner";
import { TurnDetector, wavAudio, nextPhrase } from "../voiceSession";

interface Props { hero?: boolean; model: string | null; connected: boolean; response: { content: string; done: boolean } | null; onSend: (text: string) => boolean; onInterrupt: () => void; }
const pcCommands = [
  { pattern: /^apri (?:la )?calcolatrice(?: sul pc)?[.!]?$/i, tool: "open_calculator", label: "Apri Calcolatrice sul PC" },
  { pattern: /^apri (?:il )?blocco note(?: sul pc)?[.!]?$/i, tool: "open_notepad", label: "Apri Blocco note sul PC" },
  { pattern: /^(?:mostra (?:lo )?)?stato del pc[.!]?$/i, tool: "pc_status", label: "Leggi lo stato del PC" },
];

export function HandsFreeVoice(props: Props) {
  const canControlPC = useAccount()?.role === "admin";
  const [pcAction, setPcAction] = useState<{ id: string; label: string } | null>(null);
  const [pcBusy, setPcBusy] = useState(false);
  const [actionResult, setActionResult] = useState("");
  const pendingPC = useRef(false);
  const latest = useRef(props); latest.current = props;
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [transcript, setTranscript] = useState("");
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [bargeIn, setBargeIn] = useState(false);
  const interruptible = useRef(false); interruptible.current = bargeIn;
  const [wakeEnabled, setWakeEnabled] = useState(true);
  const [voiceProfile, setVoiceProfile] = useState("default");
  const [profiles, setProfiles] = useState<string[]>(["default"]);
  const selectedVoice = useRef(voiceProfile);
  selectedVoice.current = voiceProfile;
  const waitingForWake = useRef(false);
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
    if (waitingForWake.current) return;
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
    window.addEventListener("nathion-background", stop);
    return () => { document.removeEventListener("visibilitychange", hidden); window.removeEventListener("nathion-background", stop); stop(); };
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
      const blob = await api.speak(queue.current.shift()!, abort.signal, selectedVoice.current);
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

  async function decidePC(approve: boolean) {
    if (!pcAction || pcBusy) return;
    setPcBusy(true);
    setActionResult("");
    try {
      const result = await workspaceRequest<{ status: string; result?: string }>(
        `tools/actions/${pcAction.id}/${approve ? "approve" : "reject"}`, { method: "POST" },
      );
      setPcAction(null);
      pendingPC.current = false;
      const details = result.result ? JSON.parse(result.result) : {};
      const message = details.text ?? details.detail ?? (approve ? "Esito non disponibile." : "Azione annullata.");
      setActionResult(message);
      if (running.current && approve && result.status === "completed") {
        clearTimeout(idleTimeout.current);
        queue.current.push(message);
        void playQueue();
      }
    } catch (e) {
      setActionResult(e instanceof Error ? e.message : "Operazione non riuscita.");
    } finally {
      setPcBusy(false);
    }
  }

  async function start() {
    stop(); waitingForWake.current = wakeEnabled; transcriptReceived.current = false; setMicrophoneLevel(0); setError(""); setTranscript(""); setStatus("Accesso al microfono…");
    claimAudio(owner.current, stop); running.current = true; setActive(true);
    const current = generation.current;
    let input: MediaStream | null = null;
    let context: AudioContext | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) throw new Error("Usa un browser aggiornato su HTTPS o localhost.");
      const availability = await api.voiceStatus();
      if (!availability.enabled || !availability.whisper_model_present || !availability.piper_model_present) throw new Error("Motore vocale non pronto. Controlla i modelli locali.");
      if (!running.current || current !== generation.current) return;
      setProfiles(availability.profiles);
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
          api.transcribe(wavAudio(recording, rate), abort.signal).then(({ text: recognized }) => {
            if (!running.current || current !== generation.current) return;
            let text = recognized.trim();
            if (waitingForWake.current) {
              const wake = /^(?:(?:ehi|hey|ei|ciao)[,\s]+)?(?:nathion|nation|nazione)\b[\s,.!?:-]*/iu.exec(text);
              if (!wake) {
                setStatus("In attesa di «Ehi Nathion»…");
                resetIdle();
                return;
              }
              waitingForWake.current = false;
              text = text.slice(wake[0].length).trim();
              if (!text) {
                setStatus("NATHION attivo. Dimmi pure.");
                resetIdle();
                return;
              }
            }
            setTranscript(text);
            const phone = (window as Window & { NathionPhone?: { openSettings: () => void } }).NathionPhone;
            if (phone && /^apri (?:le )?impostazioni (?:del telefono|di android)[.!]?$/i.test(text)) {
              phone.openSettings();
              setStatus("Conferma sul telefono per aprire le impostazioni.");
              resetIdle();
              return;
            }
            const delegation = /^(?:chiedi agli agenti|fai lavorare gli agenti)[\s,:]+(.+)$/iu.exec(text);
            if (delegation && latest.current.model) {
              setActionResult("");
              setStatus("Gli agenti stanno elaborando la richiesta…");
              return workspaceRequest<{ status: string; result: string }>("runs", {
                method: "POST",
                signal: abort.signal,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt: delegation[1], model: latest.current.model }),
              }).then((run) => {
                if (!running.current || current !== generation.current) return;
                if (run.status !== "completed") {
                  setActionResult("Attività interrotta. Apri Agenti per vedere l’esito.");
                  resetIdle();
                  return;
                }
                setActionResult(run.result);
                let remaining = run.result;
                for (let count = 0; count < 20; count++) {
                  const part = nextPhrase(remaining, true);
                  if (!part) break;
                  queue.current.push(part.phrase);
                  remaining = remaining.slice(part.consumed);
                }
                void playQueue();
              });
            }
            const command = canControlPC && pcCommands.find((item) => item.pattern.test(text));
            if (command) {
              if (pendingPC.current) {
                setStatus("C’è già un’azione PC da approvare o annullare.");
                resetIdle();
                return;
              }
              pendingPC.current = true;
              setStatus("Preparo la richiesta per il PC…");
              return workspaceRequest<{ id: string }>("tools/execute", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tool: "mcp", server: "pc", remote_tool: command.tool, arguments: {} }),
              }).then((action) => {
                setPcAction({ id: action.id, label: command.label });
                if (running.current && current === generation.current) {
                  setStatus("Richiesta pronta. Conferma per eseguirla.");
                  resetIdle();
                }
              }).catch((e) => {
                pendingPC.current = false;
                throw e;
              });
            }
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
      setStatus(waitingForWake.current ? "In attesa di «Ehi Nathion»…" : "Ti ascolto…");
    } catch (e) {
      if (resources.current?.context !== context) { input?.getTracks().forEach((track) => track.stop()); void context?.close().catch(() => {}); }
      if (current === generation.current) fail(e);
    }
  }
  function toggleSession() {
    if (active) {
      stop();
      latest.current.onInterrupt();
    } else {
      void start();
    }
  }

  return (
    <section className={props.hero ? "space-y-4 pb-3 text-xs" : "mb-2 space-y-2 rounded-xl border border-nathion-border p-3 text-xs"} aria-label="Conversazione vocale">
      <div className={props.hero ? "flex flex-col items-center gap-3" : "flex flex-wrap items-center gap-3"}>
        <button
          className={props.hero ? "voice-orb" : active
            ? "rounded-lg border border-nathion-border px-4 py-3 text-sm"
            : "rounded-lg bg-nathion-accent px-4 py-3 text-sm font-medium text-nathion-bg disabled:opacity-40"}
          aria-label={active ? "Ferma il microfono" : "Attiva ascolto vocale"}
          aria-pressed={active}
          disabled={!props.connected && !active}
          onClick={toggleSession}
        >
          {props.hero
            ? <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                {active ? <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" /> : <>
                  <rect x="9" y="3" width="6" height="12" rx="3" />
                  <path d="M5 11a7 7 0 0 0 14 0M12 18v3m-3 0h6" />
                </>}
              </svg>
            : active ? "Ferma microfono" : "Attiva ascolto"}
        </button>
        <span role="status">{status || (props.hero ? "Attiva ascolto" : "")}</span>
      </div>
      <details className="space-y-2">
        <summary className="cursor-pointer text-nathion-muted">Opzioni vocali</summary>
        <p className="text-nathion-muted">In attesa della parola chiave, il microfono resta attivo nella pagina. L’audio viene trascritto sul PC. Dopo l’attivazione, la sessione termina dopo 20 secondi di inattività.</p>
        <label className="block">
          <input type="checkbox" disabled={active} checked={wakeEnabled} onChange={(e) => setWakeEnabled(e.target.checked)} />
          {" "}Attiva con «Ehi Nathion» mentre l’app è aperta
        </label>
        <label className="block">
          Voce{" "}
          <select className="rounded bg-nathion-panel p-1" value={voiceProfile} onChange={(e) => setVoiceProfile(e.target.value)}>
            {profiles.map((profile) => <option key={profile} value={profile}>{profile === "default" ? "Paola" : profile}</option>)}
          </select>
        </label>
        <label className="block">
          <input type="checkbox" checked={bargeIn} onChange={(e) => setBargeIn(e.target.checked)} />
          {" "}Interrompi parlando (usa cuffie per evitare l’eco)
        </label>
        <label className="flex items-center gap-2">
          Soglia microfono
          <input type="range" min={0.008} max={0.08} step={0.002} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
        </label>
      </details>
      {active && <label className="flex items-center gap-2 text-nathion-muted">
        Segnale microfono
        <meter min={0} max={Math.max(0.08, microphoneLevel)} low={threshold} value={microphoneLevel} />
      </label>}
      {transcript && <p aria-live="polite" aria-label="Ultima frase riconosciuta">Tu: {transcript}</p>}
      {pcAction && <div className="space-y-2 rounded-lg border border-nathion-border p-3">
        <p>{pcAction.label}</p>
        <div className="flex gap-3">
          <button disabled={pcBusy} onClick={() => void decidePC(true)}>Approva ed esegui</button>
          <button disabled={pcBusy} onClick={() => void decidePC(false)}>Annulla azione</button>
        </div>
      </div>}
      {actionResult && <p role="status" className="max-h-36 overflow-auto whitespace-pre-wrap">{actionResult}</p>}
      {error && <p role="alert" className="text-red-300">{error}</p>}
    </section>
  );
}

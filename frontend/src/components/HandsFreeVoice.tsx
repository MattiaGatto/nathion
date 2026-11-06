import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useAccount } from "./AccessGate";
import { api, workspaceRequest } from "../api/client";
import { claimAudio, releaseAudio } from "../audioOwner";
import { TurnDetector, wavAudio, nextPhrase } from "../voiceSession";

interface Props { hero?: boolean; focused: boolean; onFocus: () => void; model: string | null; connected: boolean; response: { content: string; done: boolean } | null; onSend: (text: string) => boolean; onInterrupt: () => void; }
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
  const [agentTurn, setAgentTurn] = useState<{ name: string; pending: boolean } | null>(null);
  const agentVoice = useRef<{ name: string; profile: string } | null>(null);
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
  const [voiceProfile, setVoiceProfile] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<string[]>(["default"]);
  const effectiveVoice = voiceProfile ?? (profiles.includes("ugo") ? "ugo" : "default");
  const selectedVoice = useRef(effectiveVoice);
  selectedVoice.current = effectiveVoice;
  const waitingForWake = useRef(false);
  const [threshold, setThreshold] = useState(0.018);
  const thresholdRef = useRef(threshold); thresholdRef.current = threshold;
  const owner = useRef(Symbol("conversation"));
  const running = useRef(false);
  const generation = useRef(0);
  const resources = useRef<{ input: MediaStream; context: AudioContext; capture: AudioWorkletNode } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const outputContext = useRef<AudioContext | null>(null);
  const audio = useRef<AudioBufferSourceNode | null>(null);
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
    if (audio.current) {
      audio.current.onended = null;
      audio.current.stop();
      audio.current.disconnect();
      audio.current = null;
    }
    queue.current = []; playing.current = false; agentVoice.current = null;
  }
  function stop() {
    clearTimeout(idleTimeout.current);
    running.current = false; generation.current++; expected.current = false; cursor.current = 0;
    stopPlayback();
    const current = resources.current; resources.current = null;
    if (current) { current.capture.port.onmessage = null; current.capture.disconnect(); current.input.getTracks().forEach((track) => track.stop()); }
    const context = outputContext.current; outputContext.current = null;
    if (context) void context.close().catch(() => {});
    releaseAudio(owner.current); setActive(false); setStatus("");
    setAgentTurn((turn) => turn?.pending ? null : turn);
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
      const blob = await api.speak(queue.current.shift()!, abort.signal, agentVoice.current?.profile ?? selectedVoice.current);
      if (!running.current || current !== playbackGeneration.current) return;
      const context = outputContext.current;
      if (!context || context.state !== "running") throw new Error("Audio sospeso. Tocca il microfono per riattivarlo.");
      const buffer = await context.decodeAudioData(await blob.arrayBuffer());
      if (!running.current || current !== playbackGeneration.current) return;
      const player = context.createBufferSource();
      player.buffer = buffer;
      player.connect(context.destination);
      player.onended = () => {
        if (current !== playbackGeneration.current) return;
        player.disconnect();
        audio.current = null; playing.current = false;
        void playQueue();
      };
      player.start();
      audio.current = player;
      setStatus(`${agentVoice.current?.name ?? "NATHION"} parla · microfono attivo`);
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

  async function start(resume = false) {
    latest.current.onFocus();
    stop(); setAgentTurn(null); setActionResult(""); waitingForWake.current = wakeEnabled && !resume; transcriptReceived.current = false; setMicrophoneLevel(0); setError(""); setTranscript(""); setStatus("Accesso al microfono…");
    claimAudio(owner.current, stop); running.current = true; setActive(true);
    const current = generation.current;
    let input: MediaStream | null = null;
    let context: AudioContext | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) throw new Error("Usa un browser aggiornato su HTTPS o localhost.");
      // Unlock output during the click, before permission and network awaits.
      context = new AudioContext();
      outputContext.current = context;
      await context.resume();
      if (!running.current || current !== generation.current) return;
      const availability = await api.voiceStatus();
      if (!availability.enabled || !availability.whisper_model_present || !availability.piper_model_present) throw new Error("Motore vocale non pronto. Controlla i modelli locali.");
      if (!running.current || current !== generation.current) return;
      setProfiles(availability.profiles);
      input = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (!running.current || current !== generation.current) { input.getTracks().forEach((track) => track.stop()); return; }
      await context.audioWorklet.addModule("/voice-capture.js");
      if (!running.current || current !== generation.current) { input.getTracks().forEach((track) => track.stop()); return; }
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
          api.transcribe(wavAudio(recording, rate), abort.signal, waitingForWake.current, true).then(({ text: recognized }) => {
            if (!running.current || current !== generation.current) return;
            let text = recognized.trim();
            if (waitingForWake.current) {
              const wake = /^(?:(?:(?:ehi|hey|ei|e|ciao)['’,\s]+)?(?:nathion|nation|nazione)|(?:ehi|hey|ei|e)[,\s]+nei\s+ton)\b[\s,.!?:-]*/iu.exec(text);
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
            setAgentTurn(null);
            agentVoice.current = null;
            setActionResult("");
            const phone = (window as Window & { NathionPhone?: { openSettings: () => void } }).NathionPhone;
            if (phone && /^apri (?:le )?impostazioni (?:del telefono|di android)[.!]?$/i.test(text)) {
              phone.openSettings();
              setStatus("Conferma sul telefono per aprire le impostazioni.");
              resetIdle();
              return;
            }
            const delegation = /^(?:chiedi agli agenti|fai lavorare gli agenti)[\s,:]+(.+)$/iu.exec(text);
            const namedAgent = /^chiedi\s+(?:a|ad)(?:[\s,:]+(.*))?$/iu.exec(text);
            if (namedAgent || delegation) {
              const model = latest.current.model;
              setAgentTurn({ name: "", pending: true });
              setStatus(namedAgent ? "Instrado la richiesta allo specialista…" : "Gli agenti stanno elaborando la richiesta…");
              const request = namedAgent ? { command: namedAgent[1]?.trim() ?? "", model } : { prompt: delegation?.[1], model };
              const runAgent = async () => {
                try {
                  if (namedAgent && !namedAgent[1]?.trim()) throw new Error("Dimmi a quale agente vuoi chiedere.");
                  if (!namedAgent && !model) throw new Error("Scegli un modello per la chat.");
                  const run = await workspaceRequest<{ status: string; result: string; agent_name?: string; voice_profile?: string }>(
                    namedAgent ? "runs/voice" : "runs", {
                      method: "POST", signal: abort.signal, headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(request),
                    },
                  );
                  if (!running.current || current !== generation.current) return;
                  setAgentTurn({ name: run.agent_name ?? "", pending: false });
                  if (run.status !== "completed") throw new Error("Attività interrotta. Apri Agenti per vedere l’esito.");
                  if (run.agent_name && run.voice_profile) agentVoice.current = { name: run.agent_name, profile: run.voice_profile };
                  setActionResult(run.result);
                  transcriptReceived.current = true;
                  let remaining = run.result;
                  for (let count = 0; count < 20; count++) {
                    const part = nextPhrase(remaining, true);
                    if (!part) break;
                    queue.current.push(part.phrase);
                    remaining = remaining.slice(part.consumed);
                  }
                  void playQueue();
                } catch (err) {
                  if (!running.current || current !== generation.current) return;
                  setAgentTurn((turn) => turn ? { ...turn, pending: false } : null);
                  setActionResult(err instanceof Error ? err.message : "Richiesta all’agente non riuscita.");
                  setStatus("Ti ascolto…");
                  resetIdle();
                }
              };
              return runAgent();
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
      if (resources.current?.context !== context) input?.getTracks().forEach((track) => track.stop());
      if (current === generation.current) fail(e);
    }
  }
  function toggleSession() {
    if (active) {
      stop();
      latest.current.onInterrupt();
    } else {
      void start(props.focused);
    }
  }

  const phase = !active ? "idle"
    : audio.current ? "speaking"
    : agentTurn?.pending || playing.current || (props.response && !props.response.done) || status === "Trascrizione locale…" ? "processing"
    : "listening";
  const signal = phase === "listening" ? Math.min(1, microphoneLevel / 0.14) : 0;
  const phaseLabel = {
    idle: "Standby",
    listening: "In ascolto",
    processing: "Elaborazione",
    speaking: "Risposta vocale",
  }[phase];

  return (
    <section className={`voice-console ${props.hero ? "voice-console--hero" : "voice-console--compact"}`}
      data-phase={phase} data-agent={agentTurn ? "" : undefined} style={{ "--voice-signal": signal } as CSSProperties} aria-label="Conversazione vocale">
      <div className="voice-console__display">
        <button
          className="voice-orb"
          aria-label={active ? "Ferma il microfono" : props.focused ? "Continua a parlare" : "Attiva ascolto vocale"}
          aria-pressed={active}
          disabled={!props.connected && !active}
          onClick={toggleSession}
        >
          <span className="voice-orb__halo" aria-hidden="true" />
          <svg className="voice-orb__reticle" viewBox="0 0 160 160" fill="none" aria-hidden="true">
            <circle cx="80" cy="80" r="75" stroke="currentColor" strokeOpacity=".16" />
            <circle cx="80" cy="80" r="67" stroke="currentColor" strokeDasharray="1 5" strokeOpacity=".55" strokeWidth="4" />
            <circle className="voice-orb__sweep" cx="80" cy="80" r="59" stroke="currentColor" strokeDasharray="48 90 12 36" strokeWidth="2" />
            <circle cx="80" cy="80" r="48" stroke="currentColor" strokeOpacity=".24" />
            <path d="M80 0v10m0 140v10M0 80h10m140 0h10" stroke="currentColor" />
          </svg>
          <span className="voice-orb__core">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              {active ? <rect x="8" y="8" width="8" height="8" rx="1.5" fill="currentColor" /> : <>
                <rect x="9" y="3" width="6" height="12" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3m-3 0h6" />
              </>}
            </svg>
          </span>
        </button>
        <div className="voice-console__readout">
          <div className="voice-console__wave" aria-hidden="true">
            {[0.28, 0.46, 0.65, 0.87, 1, 0.7, 0.5, 0.74, 0.41, 0.29, 0.55].map((height, index) => (
              <span key={index} style={{ "--bar-height": height, "--bar-delay": `${index * -55}ms` } as CSSProperties} />
            ))}
          </div>
          {agentTurn && <p className="voice-console__agent">
            {agentTurn.name ? `Agente · ${agentTurn.name}` : "Modalità agenti"}
          </p>}
          <p className="voice-console__phase">{phaseLabel}</p>
          <p className="voice-console__status" role="status">{status || (props.focused ? "Tocca per continuare a parlare" : "Attiva ascolto")}</p>
        </div>
      </div>
      {props.focused && phase === "speaking" && <button type="button" className="mx-auto rounded-lg border border-sky-400/30 px-4 py-2 text-sm text-sky-100"
        onClick={() => {
          expected.current = false;
          stopPlayback();
          latest.current.onInterrupt();
          setStatus("Ti ascolto…");
          resetIdle();
        }}>Tocca per parlare</button>}
      {props.focused && !active && status && <p className="text-nathion-muted">Tocca il microfono per continuare a parlare.</p>}
      <details className="space-y-2">
        <summary className="cursor-pointer text-nathion-muted">Opzioni vocali</summary>
        <p className="text-nathion-muted">In attesa della parola chiave, il microfono resta attivo nella pagina. L’audio viene trascritto sul PC. Dopo l’attivazione, la sessione termina dopo 20 secondi di inattività.</p>
        <label className="block">
          <input type="checkbox" disabled={active} checked={wakeEnabled} onChange={(e) => setWakeEnabled(e.target.checked)} />
          {" "}Attiva con «Ehi Nathion» mentre l’app è aperta
        </label>
        <label className="block">
          Voce{" "}
          <select className="rounded bg-nathion-panel p-1" value={effectiveVoice} onChange={(e) => setVoiceProfile(e.target.value)}>
            {profiles.map((profile) => <option key={profile} value={profile}>{profile === "default" ? "Paola" : profile === "ugo" ? "Ugo · qualità media" : profile}</option>)}
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
      {transcript && <p aria-live="polite" aria-label="Ultima frase riconosciuta">Tu: {transcript}</p>}
      {pcAction && <div className="space-y-2 rounded-lg border border-nathion-border p-3">
        <p>{pcAction.label}</p>
        <div className="flex gap-3">
          <button disabled={pcBusy} onClick={() => void decidePC(true)}>Approva ed esegui</button>
          <button disabled={pcBusy} onClick={() => void decidePC(false)}>Annulla azione</button>
        </div>
      </div>}
      {props.focused && !agentTurn && transcriptReceived.current && props.response?.content && (
        <p className="max-h-52 overflow-auto whitespace-pre-wrap rounded-lg border border-sky-400/25 bg-sky-400/10 p-3 text-left text-sm">{props.response.content}</p>
      )}
      {actionResult && <div role="status" className={agentTurn
        ? "max-h-48 overflow-auto rounded-lg border border-violet-400/25 bg-violet-400/10 p-3 text-sm"
        : "max-h-36 overflow-auto"}>
        {agentTurn?.name && <p className="mb-1 font-semibold text-violet-200">{agentTurn.name}</p>}
        <p className="whitespace-pre-wrap">{actionResult}</p>
      </div>}
      {error && <p role="alert" className="text-red-300">{error}</p>}
    </section>
  );
}

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useAccount } from "./AccessGate";
import { api, workspaceRequest } from "../api/client";
import { claimAudio, openMicrophone, releaseAudio } from "../audioOwner";
import { TurnDetector, wavAudio, nextPhrase } from "../voiceSession";

interface VoiceAgent { id: string; name: string; voice_profile: string; }
interface Speaker { id: string; name: string; profile: string; }
interface SpokenLine { text: string; speaker?: Speaker; }
interface AgentRun { status: string; result: string; agent_name?: string; voice_profile?: string;
  trace?: { type: string; agent?: string; agent_name?: string; voice_profile?: string; result?: string }[]; }
interface OrbitAgent extends VoiceAgent { job_role?: string | null; custom: boolean; }
interface VoiceTurn { request: string; answer: string; }

interface Props { hero?: boolean; showOrbit: boolean; agentRevision: number; focused: boolean; onFocus: () => void; model: string | null; connected: boolean; response: { content: string; done: boolean } | null; onSend: (text: string) => boolean; onInterrupt: () => void; }
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
  const [orbitAgents, setOrbitAgents] = useState<OrbitAgent[]>([]);
  const [orbitPage, setOrbitPage] = useState(0);
  const orbitVisible = props.showOrbit || props.focused;
  useEffect(() => {
    if (!orbitVisible) return;
    const controller = new AbortController();
    workspaceRequest<OrbitAgent[]>("agents", { signal: controller.signal }).then((list) => {
      setOrbitAgents(list);
      setOrbitPage((page) => Math.min(page, Math.max(0, Math.ceil(list.length / 8) - 1)));
    }).catch(() => {});
    return () => controller.abort();
  }, [props.agentRevision, orbitVisible]);
  const [agentTurn, setAgentTurn] = useState<{ name: string; pending: boolean } | null>(null);
  const activeAgent = useRef<VoiceAgent | null>(null);
  const agentHistory = useRef<VoiceTurn[]>([]);
  const agentPending = useRef(false);
  const [speaker, setSpeaker] = useState<Speaker | null>(null);
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
  const releaseCapture = useRef<(() => void) | null>(null);
  const controller = useRef<AbortController | null>(null);
  const playbackController = useRef<AbortController | null>(null);
  const outputContext = useRef<AudioContext | null>(null);
  const audio = useRef<AudioBufferSourceNode | null>(null);
  const queue = useRef<SpokenLine[]>([]);
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
    playbackController.current?.abort(); playbackController.current = null;
    if (audio.current) {
      audio.current.onended = null;
      audio.current.stop();
      audio.current.disconnect();
      audio.current = null;
    }
    queue.current = []; playing.current = false; setSpeaker(null);
  }
  function stop() {
    clearTimeout(idleTimeout.current);
    running.current = false; generation.current++; expected.current = false; cursor.current = 0;
    stopPlayback();
    releaseCapture.current?.(); releaseCapture.current = null;
    const context = outputContext.current; outputContext.current = null;
    if (context) void context.close().catch(() => {});
    releaseAudio(owner.current); setActive(false); setStatus("");
    agentPending.current = false;
    setAgentTurn(activeAgent.current ? { name: activeAgent.current.name, pending: false } : null);
  }
  function fail(value: unknown) { stop(); setError(value instanceof Error ? value.message : "Sessione vocale interrotta"); }
  useEffect(() => {
    const hidden = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("nathion-background", stop);
    return () => { document.removeEventListener("visibilitychange", hidden); window.removeEventListener("nathion-background", stop); stop(); };
  }, []);
  useEffect(() => { if (!props.connected) stop(); }, [props.connected]);

  function returnToNathion(speak: boolean) {
    stopPlayback();
    activeAgent.current = null;
    agentHistory.current = [];
    agentPending.current = false;
    setAgentTurn(null);
    setActionResult("");
    setStatus("Sono Nathion, ti ascolto…");
    if (speak && running.current) {
      queue.current.push({ text: "Va bene, sono di nuovo Nathion." });
      void playQueue();
    } else if (running.current) resetIdle();
  }

  function enqueueSpeech(text: string, speaker?: Speaker, limit = 20) {
    for (let count = 0; count < limit; count++) {
      const part = nextPhrase(text, true);
      if (!part) break;
      queue.current.push({ text: part.phrase, speaker });
      text = text.slice(part.consumed);
    }
  }

  async function playQueue() {
    if (!running.current || playing.current) return;
    if (!queue.current.length) {
      if (agentPending.current) {
        setStatus(`${activeAgent.current?.name ?? "L’agente"} sta elaborando…`);
      } else if (!expected.current) {
        setStatus("Risposta terminata · ti ascolto…");
        resetIdle();
      }
      return;
    }
    playing.current = true;
    const current = playbackGeneration.current;
    try {
      setStatus("Preparazione voce…");
      const abort = new AbortController(); playbackController.current = abort;
      const line = queue.current.shift()!;
      const profile = line.speaker?.profile;
      const blob = await api.speak(line.text, abort.signal, profile ?? selectedVoice.current);
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
        audio.current = null; playing.current = false; setSpeaker(null);
        void playQueue();
      };
      player.start();
      audio.current = player;
      setSpeaker(line.speaker ?? null);
      setStatus(`${line.speaker?.name ?? "NATHION"} parla · microfono attivo`);
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
      if (part.phrase) queue.current.push({ text: part.phrase });
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
        queue.current.push({ text: message });
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
    stop(); setActionResult(""); waitingForWake.current = wakeEnabled && !resume && !activeAgent.current; transcriptReceived.current = false; setMicrophoneLevel(0); setError(""); setTranscript(""); setStatus("Accesso al microfono…");
    claimAudio(owner.current, stop); running.current = true; setActive(true);
    const current = generation.current;
    let input: MediaStream | null = null;
    const phone = (window as Window & { NathionPhone?: {
      startMicrophone?: (session: number) => void;
      stopMicrophone?: (session: number) => void;
    } }).NathionPhone;
    const native = Boolean(phone?.startMicrophone && phone.stopMicrophone);
    try {
      if (!native && (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode)) throw new Error("Usa un browser aggiornato su HTTPS o localhost.");
      // Unlock output during the click, before permission and network awaits.
      const context = new AudioContext();
      outputContext.current = context;
      await context.resume();
      if (!running.current || current !== generation.current) return;
      const availability = await api.voiceStatus();
      if (!availability.enabled || !availability.whisper_model_present || !availability.piper_model_present) throw new Error("Motore vocale non pronto. Controlla i modelli locali.");
      if (!running.current || current !== generation.current) return;
      setProfiles(availability.profiles);
      const detector = new TurnDetector();
      let preRoll: Float32Array[] = [], frames: Float32Array[] = [];
      let processing = false;
      let lastLevelUpdate = 0;
      const rate = native ? 16000 : context.sampleRate;
      const onFrame = (frame: Float32Array) => {
        if (!running.current || current !== generation.current || processing) return;
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
            const wake = /^(?:(?:(?:ehi|hey|ei|e|ciao)['’,\s]+)?(?:nathion|nation|nazione)|(?:ehi|hey|ei|e)[,\s]+nei\s+ton)\b[\s,.!?:-]*/iu.exec(text);
            if (waitingForWake.current || wake) {
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
            if (!activeAgent.current) setAgentTurn(null);
            setActionResult("");
            const phone = (window as Window & { NathionPhone?: { openSettings: () => void } }).NathionPhone;
            if (phone && /^apri (?:le )?impostazioni (?:del telefono|di android)[.!]?$/i.test(text)) {
              phone.openSettings();
              setStatus("Conferma sul telefono per aprire le impostazioni.");
              resetIdle();
              return;
            }
            const delegation = /^(?:chiedi agli agenti|fai lavorare gli agenti)[\s,:]+(.+)$/iu.exec(text);
            const namedAgent = /^(?:a\s+)?(?:chiedi\s+(?:a|ad)|passami|chiama|voglio parlare con)(?:[\s,:]+(.*))?$/iu.exec(text);
            const exitAgent = /^(?:(?:torna|ritorna|passa)\s+a\s+(?:nathion|nation|nazione)|non mi serve pi[ùu](?:\s+(?:il tuo aiuto|l.agente))?|non ho pi[ùu] bisogno(?: del tuo aiuto)?|(?:grazie[,]?\s+)?(?:ho finito|basta cos[ìi]))[.!?\s]*$/iu.test(text);
            if (activeAgent.current && exitAgent) {
              returnToNathion(true);
              return;
            }
            if (namedAgent || delegation || activeAgent.current) {
              const model = latest.current.model;
              const runAgent = async () => {
                try {
                  let target = activeAgent.current;
                  let prompt = text;
                  if (namedAgent) {
                    if (!namedAgent[1]?.trim()) throw new Error("Dimmi quale agente vuoi chiamare.");
                    const resolved = await workspaceRequest<VoiceAgent & { prompt: string }>("runs/voice/target", {
                      method: "POST", signal: abort.signal, headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ command: namedAgent[1].trim() }),
                    });
                    if (abort.signal.aborted || current !== generation.current) return;
                    if (target?.id !== resolved.id) agentHistory.current = [];
                    activeAgent.current = target = resolved;
                    prompt = resolved.prompt;
                    agentPending.current = Boolean(prompt);
                    setAgentTurn({ name: target.name, pending: Boolean(prompt) });
                    const acknowledgement = `Va bene, ti passo ${target.name}.`;
                    setStatus(acknowledgement);
                    setActionResult(acknowledgement);
                    queue.current.push({ text: acknowledgement });
                    void playQueue();
                    if (!prompt) return;
                  }
                  if (delegation) {
                    if (!model) throw new Error("Scegli un modello per la chat.");
                    prompt = delegation[1];
                  }
                  const named = delegation ? null : target;
                  agentPending.current = true;
                  setAgentTurn({ name: named ? named.name : "", pending: true });
                  if (!namedAgent) setStatus(named ? `${named.name} sta elaborando…` : "Gli agenti stanno elaborando la richiesta…");
                  const request = named
                    ? { agent_id: named.id, command: prompt, model, history: agentHistory.current }
                    : { prompt, model };
                  const run = await workspaceRequest<AgentRun>(
                    named ? "runs/voice" : "runs", {
                      method: "POST", signal: abort.signal, headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(request),
                    },
                  );
                  if (abort.signal.aborted || !running.current || current !== generation.current) return;
                  agentPending.current = false;
                  setAgentTurn({ name: run.agent_name ?? activeAgent.current?.name ?? "", pending: false });
                  if (run.status !== "completed") throw new Error("Attività interrotta. Apri Agenti per vedere l’esito.");
                  if (named) agentHistory.current = [...agentHistory.current.slice(-2), { request: prompt.slice(0, 1000), answer: run.result.slice(0, 2000) }];
                  setActionResult(run.result);
                  transcriptReceived.current = true;
                  const contributions = run.trace?.filter((item) => item.type === "completed" && item.agent && item.result) ?? [];
                  if (!named && contributions.length > 1) {
                    for (const item of contributions) {
                      const agent = { id: item.agent!, name: item.agent_name ?? item.agent!, profile: item.voice_profile ?? "default" };
                      queue.current.push({ text: `${agent.name}.` , speaker: agent });
                      enqueueSpeech(item.result!, agent, 2);
                    }
                    queue.current.push({ text: "Ti riassumo i contributi." });
                  }
                  const replySpeaker = named ? { id: named.id, name: run.agent_name ?? named.name, profile: run.voice_profile ?? named.voice_profile }
                    : contributions.length === 1
                      ? { id: contributions[0].agent!, name: contributions[0].agent_name ?? contributions[0].agent!, profile: contributions[0].voice_profile ?? "default" }
                      : undefined;
                  enqueueSpeech(run.result, replySpeaker);
                  void playQueue();
                } catch (err) {
                  if (abort.signal.aborted || !running.current || current !== generation.current) return;
                  agentPending.current = false;
                  setAgentTurn(activeAgent.current ? { name: activeAgent.current.name, pending: false } : null);
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
      const ready = () => {
        resetIdle();
        setStatus(waitingForWake.current ? "In attesa di «Ehi Nathion»…" : "Ti ascolto…");
      };
      if (native) {
        const session = (crypto.getRandomValues(new Uint32Array(1))[0] & 0x3fffffff) + 1;
        const receive = (event: Event) => {
          const detail = (event as CustomEvent<{ session: number; type: string; pcm?: string; message?: string }>).detail;
          if (!detail || detail.session !== session || !running.current || current !== generation.current) return;
          if (detail.type === "ready") ready();
          else if (detail.type === "error") fail(new Error(detail.message || "Il microfono Android si è interrotto."));
          else if (detail.pcm && !processing) {
            const bytes = atob(detail.pcm);
            const frame = new Float32Array(bytes.length / 2);
            for (let i = 0; i < frame.length; i++) {
              const pcm = bytes.charCodeAt(i * 2) | (bytes.charCodeAt(i * 2 + 1) << 8);
              frame[i] = (pcm << 16 >> 16) / 32768;
            }
            onFrame(frame);
          }
        };
        window.addEventListener("nathion-native-audio", receive);
        releaseCapture.current = () => {
          window.removeEventListener("nathion-native-audio", receive);
          phone?.stopMicrophone?.(session);
        };
        phone?.startMicrophone?.(session);
      } else {
        input = await openMicrophone(true, () => running.current && current === generation.current);
        if (!running.current || current !== generation.current) { input.getTracks().forEach((track) => track.stop()); return; }
        await context.audioWorklet.addModule("/voice-capture.js");
        if (!running.current || current !== generation.current) { input.getTracks().forEach((track) => track.stop()); return; }
        const source = context.createMediaStreamSource(input);
        const capture = new AudioWorkletNode(context, "nathion-capture");
        source.connect(capture); capture.connect(context.destination);
        capture.port.onmessage = (event: MessageEvent<Float32Array>) => onFrame(event.data);
        const tracks = input.getTracks();
        releaseCapture.current = () => {
          capture.port.onmessage = null;
          capture.disconnect();
          tracks.forEach((track) => { track.onended = null; track.stop(); });
        };
        tracks.forEach((track) => { track.onended = () => { if (running.current) fail(new Error("Il dispositivo ha interrotto il microfono")); }; });
        ready();
      }
    } catch (e) {
      input?.getTracks().forEach((track) => track.stop());
      if (current === generation.current) fail(e);
    }
  }
  function toggleSession() {
    if (active) {
      stop();
      latest.current.onInterrupt();
    } else {
      if (props.showOrbit && activeAgent.current) returnToNathion(false);
      void start(props.focused);
    }
  }

  function selectOrbitAgent(agent: OrbitAgent) {
    if (activeAgent.current?.id !== agent.id) agentHistory.current = [];
    activeAgent.current = agent;
    setAgentTurn({ name: agent.name, pending: false });
    void start(true);
  }

  const highlightedId = speaker?.id ?? activeAgent.current?.id;
  const speakerIndex = speaker ? orbitAgents.findIndex((agent) => agent.id === speaker.id) : -1;
  const displayedPage = speakerIndex < 0 ? orbitPage : Math.floor(speakerIndex / 8);
  const orbitSlice = orbitAgents.slice(displayedPage * 8, (displayedPage + 1) * 8);
  const hasOrbit = orbitVisible && (orbitSlice.length > 0 || props.focused);
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
      data-phase={phase} data-focus={props.focused || undefined} data-other-speaker={speaker ? "" : undefined} data-agent={agentTurn || speaker ? "" : undefined} style={{ "--voice-signal": signal } as CSSProperties} aria-label="Conversazione vocale">
      <div className="voice-console__display">
        <div className={hasOrbit ? "agent-orbit" : "contents"}>
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
        {hasOrbit && orbitSlice.map((agent, index) => {
          const angle = -Math.PI / 2 + 2 * Math.PI * index / orbitSlice.length;
          return <button key={agent.id} type="button"
            className="agent-orbit__agent" data-personal={agent.custom || undefined}
            data-speaking={speaker?.id === agent.id || undefined} data-selected={highlightedId === agent.id || undefined}
            style={{ left: `${50 + 39 * Math.cos(angle)}%`, top: `${50 + 39 * Math.sin(angle)}%` }}
            disabled={!props.connected || Boolean(audio.current) || agentPending.current} onClick={() => selectOrbitAgent(agent)}
            title={agent.job_role ? `${agent.name} · ${agent.job_role}` : agent.name}
            aria-label={`Parla con ${agent.name}`}>
            <span className="agent-orbit__badge" aria-hidden="true">{agent.name.slice(0, 2).toUpperCase()}</span>
            <span className="agent-orbit__name">{agent.name}</span>
          </button>;
        })}
        </div>
        {hasOrbit && orbitAgents.length > 8 && <button type="button"
          className="rounded-lg border border-sky-400/25 px-3 py-1.5 text-xs text-sky-200"
          onClick={() => setOrbitPage((page) => (page + 1) % Math.ceil(orbitAgents.length / 8))}>
          Altri agenti · {displayedPage + 1}/{Math.ceil(orbitAgents.length / 8)}
        </button>}
        <div className="voice-console__readout">
          <div className="voice-console__wave" aria-hidden="true">
            {[0.28, 0.46, 0.65, 0.87, 1, 0.7, 0.5, 0.74, 0.41, 0.29, 0.55].map((height, index) => (
              <span key={index} style={{ "--bar-height": height, "--bar-delay": `${index * -55}ms` } as CSSProperties} />
            ))}
          </div>
          {(speaker || agentTurn) && <p className="voice-console__agent">
            {speaker ? `In voce · ${speaker.name}` : agentTurn?.name ? `Agente · ${agentTurn.name}` : "Modalità agenti"}
          </p>}
          <p className="voice-console__phase">{phaseLabel}</p>
          <p className="voice-console__status" role="status">{status || (props.focused ? "Tocca per continuare a parlare" : "Attiva ascolto")}</p>
        </div>
      </div>
      {agentTurn?.name && <button type="button" className="mx-auto rounded-lg border border-violet-400/30 px-4 py-2 text-sm text-violet-200"
        onClick={() => returnToNathion(false)}>Torna a Nathion</button>}
      {props.focused && phase === "speaking" && <button type="button" className="mx-auto rounded-lg border border-sky-400/30 px-4 py-2 text-sm text-sky-100"
        onClick={() => {
          expected.current = false;
          stopPlayback();
          agentPending.current = false;
          setAgentTurn(activeAgent.current ? { name: activeAgent.current.name, pending: false } : null);
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

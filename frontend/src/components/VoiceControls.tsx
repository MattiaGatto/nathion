import { useEffect, useRef, useState } from "react";
import { api, voiceWebSocketUrl } from "../api/client";
import { claimAudio, releaseAudio } from "../audioOwner";

export interface VoiceSegment { text: string; profile?: string; speaker?: string; }
interface Props { disabled: boolean; onTranscript: (text: string) => void; reply: string; segments?: VoiceSegment[]; }
type VoiceState = "idle" | "permission" | "connecting" | "recording" | "transcribing" | "synthesizing" | "playing";

export function VoiceControls({ disabled, onTranscript, reply, segments }: Props) {
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState("");
  const [caption, setCaption] = useState("");
  const [ready, setReady] = useState({ stt: false, tts: false, checked: false });
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const url = useRef<string | null>(null);
  const timer = useRef<number>();
  const generation = useRef(0);
  const owner = useRef(Symbol("voice"));

  function stop() {
    releaseAudio(owner.current);
    generation.current++;
    clearTimeout(timer.current);
    if (recorder.current) {
      recorder.current.onstop = null;
      recorder.current.ondataavailable = null;
      if (recorder.current.state !== "inactive") recorder.current.stop();
      recorder.current = null;
    }
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (socket.current) {
      socket.current.onmessage = null;
      socket.current.onclose = null;
      socket.current.onerror = null;
      if (socket.current.readyState === WebSocket.OPEN)
        socket.current.send(JSON.stringify({ type: "cancel" }));
      socket.current.close();
      socket.current = null;
    }
    player.current?.pause();
    player.current = null;
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
    setState("idle");
  }

  useEffect(() => {
    let active = true;
    api.voiceStatus().then((status) => {
      if (active) setReady({ stt: status.enabled && status.whisper_model_present,
        tts: status.enabled && status.piper_model_present, checked: true });
    }).catch(() => { if (active) setReady({ stt: false, tts: false, checked: true }); });
    return () => { active = false; stop(); };
  }, []);

  function fail(e: unknown, current: number) {
    if (current !== generation.current) return;
    stop(); setError(e instanceof Error ? e.message : "Errore audio");
  }

  function connect(current: number, start: object, receive: (event: MessageEvent) => void) {
    const channel = new WebSocket(voiceWebSocketUrl());
    socket.current = channel;
    channel.onopen = () => {
      if (generation.current !== current) { channel.close(); return; }
      channel.send(JSON.stringify(start));
    };
    channel.onmessage = (event) => {
      if (current !== generation.current) return;
      try {
        if (typeof event.data === "string") {
          const message = JSON.parse(event.data);
          if (message.type === "error") throw new Error(message.detail);
        }
        receive(event);
      } catch (e) { fail(e, current); }
    };
    channel.onerror = () => fail(new Error("Connessione audio non disponibile"), current);
    channel.onclose = () => fail(new Error("Sessione audio chiusa prima del completamento"), current);
    return channel;
  }

  async function record() {
    stop(); setError(""); setCaption(""); setState("permission");
    claimAudio(owner.current, stop);
    const current = generation.current;
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw new Error("Microfono non disponibile. Usa localhost o una connessione HTTPS.");
      const input = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (current !== generation.current) { input.getTracks().forEach((t) => t.stop()); return; }
      stream.current = input;
      const mime = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"]
        .find((type) => MediaRecorder.isTypeSupported(type));
      if (!mime) throw new Error("Formato di registrazione non supportato dal browser.");
      const media = new MediaRecorder(input, { mimeType: mime });
      recorder.current = media;
      let uploads = Promise.resolve();
      let size = 0;
      let recordingStarted = false;
      setState("connecting");
      const channel = connect(current, { type: "transcribe", mime }, (event) => {
        const message = JSON.parse(event.data);
        if (message.type === "ready" && !recordingStarted) {
          recordingStarted = true;
          media.start(1000); setState("recording");
          timer.current = window.setTimeout(() => {
            if (media.state === "recording") media.stop();
          }, 55000);
        } else if (message.type === "partial") {
          setCaption(message.text);
        } else if (message.type === "transcript") {
          if (!message.text) throw new Error("Nessuna voce rilevata. Riprova.");
          onTranscript(message.text); setCaption(message.text); stop();
        }
      });
      media.onerror = () => fail(new Error("Registrazione interrotta dal dispositivo"), current);
      media.ondataavailable = (event) => {
        uploads = uploads.then(async () => {
          if (current !== generation.current || !event.data.size) return;
          size += event.data.size;
          if (size > 8 * 1024 * 1024) throw new Error("Registrazione troppo grande");
          const bytes = await event.data.arrayBuffer();
          if (current !== generation.current) return;
          if (channel.readyState !== WebSocket.OPEN) throw new Error("Connessione audio interrotta");
          for (let offset = 0; offset < bytes.byteLength; offset += 256 * 1024)
            channel.send(bytes.slice(offset, offset + 256 * 1024));
        }).catch((e) => fail(e, current));
      };
      media.onstop = async () => {
        clearTimeout(timer.current);
        input.getTracks().forEach((t) => t.stop());
        await uploads;
        if (current !== generation.current) return;
        setState("transcribing");
        if (channel.readyState === WebSocket.OPEN) channel.send(JSON.stringify({ type: "finish" }));
      };
    } catch (e) { fail(e, current); }
  }

  function listen() {
    stop(); setError(""); setCaption(""); setState("synthesizing");
    claimAudio(owner.current, stop);
    const current = generation.current;
    const channel = connect(current, segments ? { type: "speak", segments } : { type: "speak", text: reply }, (event) => {
      if (typeof event.data === "string") {
        const message = JSON.parse(event.data);
        if (message.type === "audio") setCaption((message.speaker ? message.speaker + ": " : "") + message.text);
        if (message.type === "done") stop();
        return;
      }
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = URL.createObjectURL(event.data);
      const audio = new Audio(url.current); player.current = audio;
      audio.onended = () => {
        if (current !== generation.current) return;
        setState("synthesizing");
        if (channel.readyState === WebSocket.OPEN) channel.send(JSON.stringify({ type: "next" }));
      };
      audio.onerror = () => fail(new Error("Riproduzione audio fallita"), current);
      audio.play().then(() => { if (current === generation.current) setState("playing"); })
        .catch((e) => fail(e, current));
    });
  }

  const buttonClass = "rounded-lg border border-nathion-border px-3 py-2 text-xs disabled:opacity-40";
  const mayRecord = state === "idle" || state === "playing" || state === "synthesizing";
  const playable = segments ? segments.length > 0 && segments.length <= 8 && segments.every((s) => s.text.length <= 4000) && segments.reduce((sum, s) => sum + s.text.length, 0) <= 16000 : reply.length > 0 && reply.length <= 4000;
  return <div className="mb-3 space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      {state === "recording" ?
        <button className={buttonClass} onClick={() => recorder.current?.stop()}>Termina e trascrivi</button> :
        <button className={buttonClass} disabled={!ready.stt || disabled || !mayRecord} onClick={record}>Registra voce</button>}
      <button className={buttonClass} disabled={!ready.tts || !playable || state !== "idle"} onClick={listen}>{segments ? "Ascolta contributi agenti" : "Ascolta ultima risposta"}</button>
      {state !== "idle" && <button className={buttonClass} onClick={stop}>Interrompi audio</button>}
      <span role="status" className="text-xs text-nathion-muted">{{ idle: "Voce locale · massimo 55 s", permission: "Accesso al microfono…", connecting: "Connessione audio…", recording: "Registrazione · trascrizione progressiva…", transcribing: "Trascrizione finale…", synthesizing: "Preparazione voce…", playing: "In riproduzione…" }[state]}</span>
    </div>
    {ready.checked && (!ready.stt || !ready.tts) && <p className="text-xs text-nathion-muted">Motore vocale non configurato completamente. Consulta la guida VOICE.</p>}
    {caption && <p aria-label="Trascrizione e testo audio" className="text-xs text-nathion-muted">{caption}</p>}
    {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
  </div>;
}

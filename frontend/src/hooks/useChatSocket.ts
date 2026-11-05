import { useCallback, useEffect, useRef, useState } from "react";
import { chatWebSocketUrl } from "../api/client";

export type ConnectionStatus = "idle" | "connecting" | "open" | "closed" | "error";

interface StreamingMessage {
  content: string;
  done: boolean;
  incomplete?: boolean;
}

/**
 * Gestisce il ciclo di vita della connessione WebSocket per una
 * conversazione: invio messaggio utente, ricezione dei chunk di
 * risposta in streaming, stato della connessione per lo
 * "Indicatore dello stato dell'assistente".
 */
export function useChatSocket(conversationId: string | null, model: string | null) {
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [streaming, setStreaming] = useState<StreamingMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const onDoneRef = useRef<(() => void) | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    // Azzera lo stato della risposta precedente: senza questo reset, se
    // si cambia conversazione mentre una risposta e' ancora a meta'
    // streaming (done: false), il fumetto incompleto resterebbe nello
    // stato del hook e potrebbe ricomparire nella conversazione sbagliata.
    setStreaming(null);
    setError(null);
    inFlightRef.current = false;

    if (!conversationId || !model) {
      setStatus("idle");
      return;
    }

    setStatus("connecting");
    const socket = new WebSocket(chatWebSocketUrl(conversationId, model));
    socketRef.current = socket;

    socket.onopen = () => setStatus("open");
    socket.onclose = () => { setStatus("closed"); setStreaming(null); inFlightRef.current = false; };
    socket.onerror = () => setStatus("error");

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "chunk") {
        setStreaming((prev) => ({
          content: (prev?.content ?? "") + data.content,
          done: false,
        }));
      } else if (data.type === "done") {
        inFlightRef.current = false;
        setStreaming((prev) => (prev ? { ...prev, done: true } : prev));
        onDoneRef.current?.();
      } else if (data.type === "error") {
        inFlightRef.current = false;
        setError(data.detail);
        setStreaming((prev) => data.code === "output_limit" && prev?.content
          ? { ...prev, done: true, incomplete: true }
          : null);
      } else if (data.type === "cancelled") {
        inFlightRef.current = false;
        setStreaming(null);
        onDoneRef.current?.();
      }
    };

    return () => {
      socket.onopen = null; socket.onclose = null; socket.onerror = null; socket.onmessage = null;
      socket.close();
      socketRef.current = null;
      onDoneRef.current = null;
    };
  }, [conversationId, model]);

  const sendMessage = useCallback((text: string, onDone?: () => void) => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      setError("Connessione non ancora pronta, riprova tra un istante.");
      return false;
    }
    if (inFlightRef.current) return false;
    inFlightRef.current = true;
    setError(null);
    setStreaming({ content: "", done: false });
    onDoneRef.current = onDone ?? null;
    socketRef.current.send(JSON.stringify({ type: "message", content: text }));
    return true;
  }, []);

  const cancel = useCallback(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN)
      socketRef.current.send(JSON.stringify({ type: "cancel" }));
  }, []);

  return { status, streaming, error, sendMessage, cancel };
}

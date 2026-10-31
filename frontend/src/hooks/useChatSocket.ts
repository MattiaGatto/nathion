import { useCallback, useEffect, useRef, useState } from "react";
import { chatWebSocketUrl } from "../api/client";

export type ConnectionStatus = "idle" | "connecting" | "open" | "closed" | "error";

interface StreamingMessage {
  content: string;
  done: boolean;
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

  useEffect(() => {
    if (!conversationId || !model) return;

    setStatus("connecting");
    const socket = new WebSocket(chatWebSocketUrl(conversationId, model));
    socketRef.current = socket;

    socket.onopen = () => setStatus("open");
    socket.onclose = () => setStatus("closed");
    socket.onerror = () => setStatus("error");

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "chunk") {
        setStreaming((prev) => ({
          content: (prev?.content ?? "") + data.content,
          done: false,
        }));
      } else if (data.type === "done") {
        setStreaming((prev) => (prev ? { ...prev, done: true } : prev));
        onDoneRef.current?.();
      } else if (data.type === "error") {
        setError(data.detail);
        setStreaming(null);
      }
    };

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [conversationId, model]);

  const sendMessage = useCallback((text: string, onDone?: () => void) => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      setError("Connessione non ancora pronta, riprova tra un istante.");
      return;
    }
    setError(null);
    setStreaming({ content: "", done: false });
    onDoneRef.current = onDone ?? null;
    socketRef.current.send(text);
  }, []);

  return { status, streaming, error, sendMessage };
}

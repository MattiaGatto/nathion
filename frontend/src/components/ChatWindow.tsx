import { FormEvent, useEffect, useRef, useState } from "react";
import { api, type ConversationDetail, type MessageOut } from "../api/client";
import { useChatSocket } from "../hooks/useChatSocket";
import { MessageBubble } from "./MessageBubble";
import { ModelSelector } from "./ModelSelector";
import { StatusIndicator } from "./StatusIndicator";

export function ChatWindow() {
  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [initError, setInitError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { status, streaming, error, sendMessage } = useChatSocket(
    conversation?.id ?? null,
    model
  );

  // Crea una conversazione all'avvio (Milestone 1: una sola conversazione
  // attiva, lo storico multi-conversazione arriva in una milestone
  // successiva dedicata alla UI).
  useEffect(() => {
    api
      .createConversation()
      .then((c) => api.getConversation(c.id))
      .then(setConversation)
      .catch((err) => setInitError(err.message));
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [conversation, streaming]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || !conversation) return;

    const userMessage: MessageOut = {
      id: `local-${Date.now()}`,
      role: "user",
      content: text,
      model_used: null,
      created_at: new Date().toISOString(),
    };
    setConversation((prev) => prev && { ...prev, messages: [...prev.messages, userMessage] });
    setInput("");

    sendMessage(text, () => {
      // A fine streaming, ri-sincronizza dal backend per avere l'id e il
      // contenuto definitivo del messaggio assistente appena salvato.
      if (conversation) {
        api.getConversation(conversation.id).then(setConversation);
      }
    });
  }

  if (initError) {
    return (
      <div className="p-6 text-sm text-red-400">
        Impossibile avviare la conversazione: {initError}
        <br />
        Verifica che il backend sia raggiungibile su <code>/health</code>.
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-nathion-bg">
      <header className="flex items-center justify-between border-b border-white/5 px-6 py-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">NATHION</h1>
          <p className="text-xs text-slate-500">Your Intelligence. Your System. Your Control.</p>
        </div>
        <div className="flex items-center gap-4">
          <ModelSelector selectedModel={model} onChange={setModel} />
          <StatusIndicator status={status} />
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
        {conversation?.messages.map((m) => <MessageBubble key={m.id} message={m} />)}
        {streaming && !streaming.done && (
          <MessageBubble message={{ role: "assistant", content: streaming.content || "..." }} />
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 border-t border-white/5 px-6 py-4">
        <input
          className="flex-1 rounded-lg border border-white/10 bg-nathion-panel px-4 py-2 text-sm text-slate-100 outline-none focus:border-nathion-accent"
          placeholder={model ? "Scrivi un messaggio..." : "Seleziona un modello per iniziare..."}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={!model || !conversation}
        />
        <button
          type="submit"
          className="rounded-lg bg-nathion-accent px-4 py-2 text-sm font-medium text-nathion-bg disabled:opacity-40"
          disabled={!model || !conversation || !input.trim()}
        >
          Invia
        </button>
      </form>
    </div>
  );
}

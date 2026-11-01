import { useEffect, useRef, useState } from "react";
import { api, type ConversationDetail, type MessageOut } from "../api/client";
import { useChatSocket } from "../hooks/useChatSocket";
import { Composer } from "./Composer";
import { EmptyState } from "./EmptyState";
import { MessageBubble } from "./MessageBubble";
import { StatusIndicator } from "./StatusIndicator";
import { TypingIndicator } from "./TypingIndicator";

interface Props {
  conversationId: string;
  model: string | null;
  onConversationUpdated: () => void;
  onOpenSettings: () => void;
}

export function ChatWindow({
  conversationId,
  model,
  onConversationUpdated,
  onOpenSettings,
}: Props) {
  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { status, streaming, error, sendMessage } = useChatSocket(conversationId, model);

  useEffect(() => {
    setConversation(null);
    setLoadError(null);
    api
      .getConversation(conversationId)
      .then(setConversation)
      .catch((err) => setLoadError(err.message));
  }, [conversationId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [conversation, streaming]);

  function handleSend(text: string) {
    if (!conversation) return;

    const optimisticUser: MessageOut = {
      id: `local-${crypto.randomUUID()}`,
      role: "user",
      content: text,
      model_used: null,
      created_at: new Date().toISOString(),
    };
    setConversation((prev) => prev && { ...prev, messages: [...prev.messages, optimisticUser] });

    sendMessage(text, () => {
      api
        .getConversation(conversationId)
        .then(setConversation)
        .finally(onConversationUpdated);
    });
  }

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-red-400">
        Impossibile aprire la conversazione: {loadError}
      </div>
    );
  }

  const hasMessages = (conversation?.messages.length ?? 0) > 0;
  const awaitingFirstChunk = streaming !== null && !streaming.done && streaming.content === "";

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-nathion-border bg-nathion-bg/80 px-6 py-3 backdrop-blur">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-medium text-nathion-text">
            {conversation?.title ?? "Nuova conversazione"}
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={onOpenSettings}
            className="rounded-full border border-nathion-border bg-nathion-panel px-2.5 py-1 font-mono text-[11px] text-nathion-muted transition hover:border-nathion-accent-dim/40 hover:text-nathion-text"
            title="Cambia modello nelle impostazioni"
          >
            {model ?? "nessun modello"}
          </button>
          <StatusIndicator status={status} />
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {!hasMessages && !streaming ? (
          <EmptyState onPick={handleSend} />
        ) : (
          <div className="mx-auto max-w-3xl space-y-4 px-6 py-6">
            {conversation?.messages.map((m) => <MessageBubble key={m.id} message={m} />)}

            {streaming && !streaming.done && (
              <div className="flex items-end gap-2.5">
                <div className="mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-nathion-panel ring-1 ring-nathion-border">
                  <span className="h-2 w-2 rounded-full bg-nathion-accent" />
                </div>
                <div className="rounded-2xl rounded-bl-sm border border-nathion-border bg-nathion-panel px-4 py-2.5 text-[0.9rem] leading-relaxed text-nathion-text">
                  {awaitingFirstChunk ? (
                    <TypingIndicator />
                  ) : (
                    <span className="whitespace-pre-wrap">{streaming.content}</span>
                  )}
                </div>
              </div>
            )}

            {error && (
              <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {error}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-nathion-border px-6 py-4">
        <div className="mx-auto max-w-3xl">
          <Composer
            disabled={!model}
            placeholder={model ? "Scrivi un messaggio…" : "Seleziona un modello dalle impostazioni…"}
            onSend={handleSend}
          />
          <p className="mt-2 text-center text-[11px] text-nathion-muted">
            NATHION puo&apos; commettere errori. Verifica le informazioni importanti.
          </p>
        </div>
      </div>
    </div>
  );
}

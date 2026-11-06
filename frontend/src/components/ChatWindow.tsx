import { HandsFreeVoice } from "./HandsFreeVoice";
import { MemorySuggestions } from "./MemorySuggestions";
import { useEffect, useRef, useState } from "react";
import { api, type ConversationDetail, type MessageOut } from "../api/client";
import { useChatSocket } from "../hooks/useChatSocket";
import { Composer } from "./Composer";
import { MessageBubble } from "./MessageBubble";
import { StatusIndicator } from "./StatusIndicator";
import { TypingIndicator } from "./TypingIndicator";
import { VoiceControls } from "./VoiceControls";

interface Props {
  conversationId: string;
  agentRevision: number;
  model: string | null;
  onConversationUpdated: () => void;
  onOpenSettings: () => void;
}

export function ChatWindow({
  conversationId,
  agentRevision,
  model,
  onConversationUpdated,
  onOpenSettings,
}: Props) {
  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [voiceFocus, setVoiceFocus] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [voiceDraft, setVoiceDraft] = useState<{ text: string }>();

  const { status, streaming, error, sendMessage, cancel } = useChatSocket(conversationId, model);

  useEffect(() => {
    setConversation(null);
    setVoiceDraft(undefined);
    setLoadError(null);
    api
      .getConversation(conversationId)
      .then(setConversation)
      .catch((err) => setLoadError(err.message));
  }, [conversationId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [conversation, streaming]);

  function handleSend(text: string, voice = false) {
    if (!conversation || status !== "open" || (streaming && !streaming.done)) return false;

    const optimisticUser: MessageOut = {
      id: `local-${crypto.randomUUID()}`,
      role: "user",
      content: text,
      model_used: null,
      created_at: new Date().toISOString(),
    };
    const accepted = sendMessage(text, () => {
      api
        .getConversation(conversationId)
        .then(setConversation)
        .finally(onConversationUpdated);
    }, voice);
    if (accepted) setConversation((prev) => prev && { ...prev, messages: [...prev.messages, optimisticUser] });
    return accepted;
  }

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-red-400">
        Impossibile aprire la conversazione: {loadError}
      </div>
    );
  }

  const hasMessages = (conversation?.messages.length ?? 0) > 0;
  const showHero = !hasMessages && !streaming && !error;
  const awaitingFirstChunk = streaming !== null && !streaming.done && streaming.content === "";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className={voiceFocus ? "hidden" : "flex items-center justify-between gap-2 border-b border-nathion-border bg-nathion-bg/80 px-3 py-3 backdrop-blur sm:px-6"}>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-medium text-nathion-text">
            {conversation?.title ?? "Nuova conversazione"}
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={onOpenSettings}
            className="max-w-[9rem] truncate rounded-full border border-nathion-border bg-nathion-panel px-2.5 py-1 font-mono text-[11px] text-nathion-muted transition hover:border-nathion-accent-dim/40 hover:text-nathion-text"
            title="Cambia modello nelle impostazioni"
          >
            {model ?? "nessun modello"}
          </button>
          <StatusIndicator status={status} />
        </div>
      </header>

      <div ref={scrollRef} className={!voiceFocus && !showHero ? "min-h-0 flex-1 overflow-y-auto" : "hidden"}>
        {(hasMessages || streaming || error) && (
          <div className="mx-auto max-w-3xl space-y-4 px-3 py-4 sm:px-6 sm:py-6">
            {conversation?.messages.map((m) => <MessageBubble key={m.id} message={m} />)}

            {streaming && (!streaming.done || streaming.incomplete) && (
              <div className="flex items-end gap-2.5">
                <div className="mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-nathion-panel ring-1 ring-nathion-border">
                  <span className="h-2 w-2 rounded-full bg-nathion-accent" />
                </div>
                <div className="rounded-2xl rounded-bl-sm border border-nathion-border bg-nathion-panel px-4 py-2.5 text-[0.9rem] leading-relaxed text-nathion-text">
                  {streaming.incomplete && <p className="mb-2 text-xs text-nathion-muted">Risposta parziale · non salvata</p>}
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

      <div className={voiceFocus
        ? "voice-stage fixed inset-0 z-[60] flex flex-col items-center overflow-y-auto px-3 py-4 text-center sm:px-6"
        : showHero
        ? "flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-3 py-4 text-center sm:px-6"
        : "mx-auto w-full max-w-3xl shrink-0 px-3 sm:px-6"}>
        {voiceFocus && <div className="mb-4 flex w-full max-w-xl items-center justify-between gap-2 text-left">
          <p className="font-mono text-xs uppercase tracking-widest text-sky-200">Modalità voce</p>
          <button className="rounded-lg border border-nathion-border px-3 py-2 text-xs" onClick={() => setVoiceFocus(false)}>Mostra chat</button>
        </div>}
        {showHero && !voiceFocus && <div className="mt-auto" />}
        {showHero && !voiceFocus && <div className="mb-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.24em] text-nathion-accent">Assistente vocale</p>
          <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-5xl">Di cosa parliamo?</h2>
          <p className="mt-3 text-sm text-nathion-muted">Attiva l’ascolto, poi di’ «Ehi Nathion» e fai la tua domanda.</p>
        </div>}
        <div className={voiceFocus ? "w-full max-w-4xl" : "w-full max-w-xl"}>
          <HandsFreeVoice agentRevision={agentRevision} showOrbit={showHero && !voiceFocus} hero={voiceFocus || showHero} focused={voiceFocus} onFocus={() => setVoiceFocus(true)} model={model} connected={status === "open"} response={streaming} onSend={(text) => handleSend(text, true)} onInterrupt={cancel} />
        </div>
        {showHero && !voiceFocus && <div className="mb-auto" />}
      </div>

      <div className={voiceFocus ? "hidden" : "border-t border-nathion-border px-3 py-3 sm:px-6 sm:py-4"}>
        <div className="mx-auto max-w-3xl">
          {streaming && !streaming.done && <button className="mb-3 rounded-lg border border-nathion-border px-3 py-2 text-xs" onClick={cancel}>Interrompi risposta</button>}
          <details className="mb-3">
            <summary className="cursor-pointer text-xs text-nathion-muted">Registrazione manuale e memoria</summary>
          <VoiceControls key={conversationId} disabled={status !== "open" || Boolean(streaming && !streaming.done)}
            onTranscript={(text) => setVoiceDraft({ text })}
            reply={conversation?.messages.filter((m) => m.role === "assistant").at(-1)?.content ?? ""} />
          <MemorySuggestions key={`memory-${conversationId}`} conversationId={conversationId} model={model} />
          </details>
          <Composer
            draft={voiceDraft}
            disabled={status !== "open" || Boolean(streaming && !streaming.done)}
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

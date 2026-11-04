import { KeyboardEvent, useEffect, useRef, useState } from "react";

interface Props {
  disabled: boolean;
  placeholder: string;
  onSend: (text: string) => void;
  draft?: { text: string };
}

const MAX_HEIGHT_PX = 160;

/** Textarea che cresce con il contenuto (fino a un limite), Invio per
 * inviare e Shift+Invio per andare a capo — comportamento atteso in
 * qualunque client di chat moderno. */
export function Composer({ disabled, placeholder, onSend, draft }: Props) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (draft !== undefined) setValue(draft.text); }, [draft]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [value]);

  function submit() {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="flex items-end gap-2 rounded-2xl border border-nathion-border bg-nathion-panel p-2 pl-4 shadow-panel transition focus-within:border-nathion-accent-dim/50">
      <textarea
        ref={textareaRef}
        rows={1}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={placeholder}
        className="max-h-40 flex-1 resize-none bg-transparent py-2 text-sm text-nathion-text placeholder:text-nathion-muted focus:outline-none disabled:opacity-50"
      />
      <button
        onClick={submit}
        disabled={disabled || !value.trim()}
        aria-label="Invia messaggio"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-nathion-accent text-nathion-bg transition hover:bg-nathion-accent-dim disabled:cursor-not-allowed disabled:opacity-30"
      >
        <SendIcon />
      </button>
    </div>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4" aria-hidden="true">
      <path
        d="M2 8.3 13.5 2.7 9.2 13.5l-1.6-4.6L2 8.3Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

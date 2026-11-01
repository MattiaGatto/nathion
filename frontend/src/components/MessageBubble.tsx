import type { MessageOut } from "../api/client";
import { BrandMark } from "./Brand";

interface Props {
  message: Pick<MessageOut, "role" | "content"> & { created_at?: string };
}

function formatTime(iso?: string): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === "user";
  const time = formatTime(message.created_at);

  return (
    <div
      className={`group flex animate-fade-in-up items-end gap-2.5 ${
        isUser ? "flex-row-reverse" : "flex-row"
      }`}
    >
      {!isUser && (
        <div className="mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-nathion-panel ring-1 ring-nathion-border">
          <BrandMark className="h-4 w-4" />
        </div>
      )}

      <div className={`flex max-w-[75%] flex-col ${isUser ? "items-end" : "items-start"}`}>
        <div
          className={`whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[0.9rem] leading-relaxed ${
            isUser
              ? "rounded-br-sm bg-gradient-to-br from-nathion-accent to-nathion-accent-dim text-nathion-bg"
              : "rounded-bl-sm border border-nathion-border bg-nathion-panel text-nathion-text"
          }`}
        >
          {message.content}
        </div>
        {time && (
          <span className="mt-1 px-1 text-[10px] text-nathion-muted opacity-0 transition-opacity group-hover:opacity-100">
            {time}
          </span>
        )}
      </div>
    </div>
  );
}

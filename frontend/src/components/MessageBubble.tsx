import type { MessageOut } from "../api/client";

export function MessageBubble({ message }: { message: Pick<MessageOut, "role" | "content"> }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${
          isUser
            ? "bg-nathion-accent text-nathion-bg"
            : "bg-nathion-panel text-slate-100 border border-white/5"
        }`}
      >
        {message.content}
      </div>
    </div>
  );
}

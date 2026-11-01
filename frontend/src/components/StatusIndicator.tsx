import type { ConnectionStatus } from "../hooks/useChatSocket";

const LABELS: Record<ConnectionStatus, string> = {
  idle: "In attesa",
  connecting: "Connessione…",
  open: "Online",
  closed: "Disconnesso",
  error: "Errore",
};

const DOT_CLASSES: Record<ConnectionStatus, string> = {
  idle: "bg-nathion-muted",
  connecting: "bg-amber-400 animate-pulse-dot",
  open: "bg-nathion-accent shadow-[0_0_8px_1px_rgba(94,234,212,0.6)]",
  closed: "bg-nathion-muted",
  error: "bg-red-500",
};

export function StatusIndicator({ status }: { status: ConnectionStatus }) {
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-nathion-border bg-nathion-panel px-2.5 py-1 text-[11px] text-nathion-muted">
      <span className={`h-1.5 w-1.5 rounded-full ${DOT_CLASSES[status]}`} />
      {LABELS[status]}
    </div>
  );
}

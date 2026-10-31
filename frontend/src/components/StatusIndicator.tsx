import type { ConnectionStatus } from "../hooks/useChatSocket";

const LABELS: Record<ConnectionStatus, string> = {
  idle: "In attesa",
  connecting: "Connessione...",
  open: "Connesso",
  closed: "Disconnesso",
  error: "Errore",
};

const COLORS: Record<ConnectionStatus, string> = {
  idle: "bg-slate-500",
  connecting: "bg-amber-400 animate-pulse",
  open: "bg-emerald-400",
  closed: "bg-slate-500",
  error: "bg-red-500",
};

export function StatusIndicator({ status }: { status: ConnectionStatus }) {
  return (
    <div className="flex items-center gap-2 text-xs text-slate-400">
      <span className={`h-2 w-2 rounded-full ${COLORS[status]}`} />
      {LABELS[status]}
    </div>
  );
}

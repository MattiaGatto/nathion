import { useState } from "react";
import type { ConversationSummary } from "../api/client";
import { BrandWordmark } from "./Brand";

interface Props {
  conversations: ConversationSummary[];
  activeId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onOpenSettings: () => void;
  onOpenAgents: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "ora";
  if (minutes < 60) return `${minutes}m fa`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h fa`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}g fa`;
  return new Date(iso).toLocaleDateString("it-IT", { day: "numeric", month: "short" });
}

export function Sidebar({
  conversations,
  activeId,
  loading,
  onSelect,
  onNew,
  onDelete,
  onOpenSettings,
  onOpenAgents,
  collapsed,
  onToggleCollapsed,
}: Props) {
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  if (collapsed) {
    return (
      <aside className="flex h-full w-14 flex-col items-center gap-3 border-r border-nathion-border bg-nathion-surface py-4">
        <button
          onClick={onToggleCollapsed}
          className="rounded-lg p-2 text-nathion-muted transition hover:bg-nathion-panel hover:text-nathion-text"
          title="Espandi la barra laterale"
        >
          <ChevronIcon direction="right" />
        </button>
        <button
          onClick={onNew}
          className="rounded-lg bg-nathion-panel p-2 text-nathion-accent transition hover:bg-nathion-panel-hover"
          title="Nuova conversazione"
        >
          <PlusIcon />
        </button>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-nathion-border bg-nathion-surface">
      <div className="flex items-center justify-between px-4 py-4">
        <BrandWordmark />
        <button
          onClick={onToggleCollapsed}
          className="rounded-lg p-1.5 text-nathion-muted transition hover:bg-nathion-panel hover:text-nathion-text"
          title="Comprimi la barra laterale"
        >
          <ChevronIcon direction="left" />
        </button>
      </div>

      <div className="px-3">
        <button
          onClick={onNew}
          className="flex w-full items-center gap-2 rounded-xl border border-nathion-border bg-nathion-panel px-3 py-2.5 text-sm font-medium text-nathion-text transition hover:border-nathion-accent-dim/40 hover:bg-nathion-panel-hover"
        >
          <PlusIcon />
          Nuova conversazione
        </button>
      </div>

      <div className="mt-4 flex-1 overflow-y-auto px-3 pb-3">
        <p className="px-1 pb-2 text-[11px] font-medium uppercase tracking-wider text-nathion-muted">
          Cronologia
        </p>

        {loading && (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg bg-nathion-panel/60" />
            ))}
          </div>
        )}

        {!loading && conversations.length === 0 && (
          <p className="px-1 py-2 text-xs text-nathion-muted">
            Nessuna conversazione ancora. Inizia a scrivere per crearne una.
          </p>
        )}

        <ul className="space-y-1">
          {conversations.map((c) => (
            <li key={c.id} className="group relative animate-slide-in">
              <button
                onClick={() => onSelect(c.id)}
                className={`flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 pr-8 text-left transition ${
                  c.id === activeId
                    ? "bg-nathion-panel shadow-glow ring-1 ring-nathion-accent/30"
                    : "hover:bg-nathion-panel/70"
                }`}
              >
                <span className="truncate text-sm text-nathion-text">{c.title}</span>
                <span className="text-[11px] text-nathion-muted">{relativeTime(c.updated_at)}</span>
              </button>

              {pendingDeleteId === c.id ? (
                <div className="absolute right-1 top-1 flex gap-0.5">
                  <button
                    onClick={() => {
                      onDelete(c.id);
                      setPendingDeleteId(null);
                    }}
                    className="rounded-md bg-red-500/90 px-1.5 py-1 text-[10px] font-medium text-white hover:bg-red-500"
                  >
                    Elimina
                  </button>
                  <button
                    onClick={() => setPendingDeleteId(null)}
                    className="rounded-md px-1.5 py-1 text-[10px] text-nathion-muted hover:text-nathion-text"
                  >
                    Annulla
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setPendingDeleteId(c.id)}
                  className="absolute right-1.5 top-1.5 rounded-md p-1 text-nathion-muted opacity-0 transition hover:bg-nathion-panel-hover hover:text-red-400 group-hover:opacity-100"
                  title="Elimina conversazione"
                >
                  <TrashIcon />
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="border-t border-nathion-border p-3">
        <button onClick={onOpenAgents} className="mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-nathion-accent hover:bg-nathion-panel">
          <AgentsIcon /> Agenti
        </button>
        <button
          onClick={onOpenSettings}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-nathion-muted transition hover:bg-nathion-panel hover:text-nathion-text"
        >
          <GearIcon />
          Impostazioni
        </button>
      </div>
    </aside>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4" aria-hidden="true">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
      <path
        d="M3 5h10M6.5 5V3.5h3V5M4.5 5l.5 8h6l.5-8"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AgentsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4" aria-hidden="true">
      <circle cx="8" cy="8" r="1.6" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="3" cy="4" r="1.1" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="13" cy="4" r="1.1" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="8" cy="13.5" r="1.1" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M7 7l-3-2.3M9 7l3-2.3M8 9.6v2.8"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4" aria-hidden="true">
      <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M8 1.6v1.3M8 13.1v1.3M14.4 8h-1.3M2.9 8H1.6M12.4 3.6l-.9.9M4.5 11.5l-.9.9M12.4 12.4l-.9-.9M4.5 4.5l-.9-.9"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      className={`h-4 w-4 transition-transform ${direction === "right" ? "rotate-180" : ""}`}
      aria-hidden="true"
    >
      <path
        d="M10 3 5 8l5 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

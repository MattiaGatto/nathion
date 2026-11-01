import { useEffect, useState } from "react";
import { api, type ModelInfo } from "../api/client";

interface Props {
  open: boolean;
  onClose: () => void;
  currentModel: string | null;
  onModelSaved: (model: string) => void;
}

/**
 * Pannello impostazioni: elenco dei modelli Ollama realmente disponibili
 * (interrogati dal backend, non una lista statica) e salvataggio della
 * preferenza di default lato server, cosi' sopravvive a un refresh o a
 * una nuova sessione (requisito §3.5 "Persistenza").
 */
export function SettingsPanel({ open, onClose, currentModel, onModelSaved }: Props) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(currentModel);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setLoadError(null);
    setSaved(false);
    api
      .listModels()
      .then((list) => {
        setModels(list);
        setSelected((prev) => prev ?? list[0]?.id ?? null);
      })
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    setSelected(currentModel);
  }, [currentModel]);

  if (!open) return null;

  async function handleSave() {
    if (!selected) return;
    setSaving(true);
    try {
      await api.updateSettings({ default_provider: "ollama", default_model: selected });
      onModelSaved(selected);
      setSaved(true);
      setTimeout(() => onClose(), 500);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Salvataggio non riuscito");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md animate-fade-in-up rounded-2xl border border-nathion-border bg-nathion-panel p-6 shadow-panel"
      >
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold text-nathion-text">Impostazioni</h2>
            <p className="mt-0.5 text-sm text-nathion-muted">
              Provider e modello usati per le nuove risposte.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-nathion-muted transition hover:bg-nathion-panel-hover hover:text-nathion-text"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-nathion-muted">
              Provider LLM
            </label>
            <div className="flex items-center gap-2 rounded-lg border border-nathion-border bg-nathion-surface px-3 py-2 text-sm text-nathion-text">
              <span className="h-1.5 w-1.5 rounded-full bg-nathion-accent" />
              Ollama (locale)
            </div>
            <p className="mt-1 text-[11px] text-nathion-muted">
              Altri provider (LM Studio, vLLM, OpenAI) arriveranno in milestone successive — il
              gateway e&apos; gia&apos; pronto ad accoglierli.
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-nathion-muted">
              Modello
            </label>

            {loading && (
              <div className="h-10 animate-pulse rounded-lg bg-nathion-surface" />
            )}

            {!loading && loadError && (
              <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {loadError}
              </p>
            )}

            {!loading && !loadError && models.length === 0 && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                Nessun modello trovato. Esegui{" "}
                <code className="rounded bg-black/30 px-1">ollama pull &lt;nome&gt;</code> e
                riapri questo pannello.
              </p>
            )}

            {!loading && !loadError && models.length > 0 && (
              <select
                value={selected ?? ""}
                onChange={(e) => setSelected(e.target.value)}
                className="w-full rounded-lg border border-nathion-border bg-nathion-surface px-3 py-2 text-sm text-nathion-text outline-none transition focus:border-nathion-accent-dim"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-3.5 py-2 text-sm text-nathion-muted transition hover:text-nathion-text"
          >
            Annulla
          </button>
          <button
            onClick={handleSave}
            disabled={!selected || saving || loading}
            className="rounded-lg bg-nathion-accent px-4 py-2 text-sm font-medium text-nathion-bg transition hover:bg-nathion-accent-dim disabled:opacity-40"
          >
            {saved ? "Salvato ✓" : saving ? "Salvataggio…" : "Salva"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

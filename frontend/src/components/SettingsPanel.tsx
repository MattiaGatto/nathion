import { useEffect, useState } from "react";
import { api, type ModelInfo } from "../api/client";

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenProfile: () => void;
  currentModel: string | null;
  onModelSaved: (model: string) => void;
}

/**
 * Pannello impostazioni: elenco dei modelli Ollama realmente disponibili
 * (interrogati dal backend, non una lista statica) e salvataggio della
 * preferenza di default lato server, cosi' sopravvive a un refresh o a
 * una nuova sessione (requisito §3.5 "Persistenza").
 */
export function SettingsPanel({ open, onClose, onOpenProfile, currentModel, onModelSaved }: Props) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(currentModel);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [provider, setProvider] = useState("ollama");
  const [providers, setProviders] = useState<string[]>(["ollama"]);

  useEffect(() => {
    if (!open) return;
    Promise.all([api.getSettings(), api.listProviders()]).then(([settings, available]) => {
      setProvider(settings.default_provider); setProviders(available);
    }).catch((e) => setLoadError(e.message));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    let active = true;
    setLoadError(null);
    setSaved(false);
    api
      .listModels(provider)
      .then((list) => {
        if (!active) return;
        setModels(list);
        setSelected((prev) => list.some((m) => m.id === prev) ? prev : list[0]?.id ?? null);
      })
      .catch((err) => { if (active) setLoadError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, provider]);

  useEffect(() => {
    setSelected(currentModel);
  }, [currentModel]);

  if (!open) return null;

  async function handleSave() {
    if (!selected) return;
    setSaving(true);
    try {
      await api.updateSettings({ default_provider: provider, default_model: selected });
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto animate-fade-in-up rounded-2xl border border-nathion-border bg-nathion-panel p-6 shadow-panel"
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

        <button type="button" onClick={onOpenProfile} className="mb-5 flex w-full items-center justify-between gap-3 rounded-xl border border-sky-400/25 bg-sky-400/10 p-3 text-left">
          <span><strong className="block text-sm text-sky-200">Modifica profilo</strong><small className="text-nathion-muted">Avatar, dati personali e bio</small></span>
          <span aria-hidden="true">→</span>
        </button>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-nathion-muted">
              Provider LLM
            </label>
            <select aria-label="Provider LLM" className="w-full rounded-lg bg-nathion-surface p-2" value={provider} onChange={(e) => { setProvider(e.target.value); setSelected(null); }}>{providers.map((name) => <option key={name} value={name}>{name === "ollama" ? "Ollama (locale)" : "Server compatibile configurato"}</option>)}</select>
            <p className="mt-1 text-[11px] text-nathion-muted">
              Le connessioni aggiuntive vengono abilitate dalla configurazione del proprietario.
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
                    {m.label}{m.id === "llama3.2:3b" ? " · Voce rapida" : m.id === "qwen3.5:4b" ? " · Modello multimodale" : ""}
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

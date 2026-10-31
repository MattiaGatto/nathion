import { useEffect, useState } from "react";
import { api, type ModelInfo } from "../api/client";

interface Props {
  selectedModel: string | null;
  onChange: (model: string) => void;
}

/**
 * Selettore del modello Ollama, popolato interrogando il backend (che a
 * sua volta chiede a Ollama quali modelli sono scaricati localmente —
 * nessuna lista statica, così mostra sempre solo ciò che è davvero
 * disponibile sulla macchina dell'utente).
 */
export function ModelSelector({ selectedModel, onChange }: Props) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .listModels()
      .then((list) => {
        if (cancelled) return;
        setModels(list);
        setLoadError(null);
        if (!selectedModel && list.length > 0) {
          onChange(list[0].id);
        }
      })
      .catch((err) => !cancelled && setLoadError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return <p className="text-xs text-slate-400">Carico i modelli disponibili da Ollama...</p>;
  }

  if (loadError) {
    return (
      <p className="text-xs text-red-400">
        Impossibile leggere i modelli da Ollama: {loadError}
      </p>
    );
  }

  if (models.length === 0) {
    return (
      <p className="text-xs text-amber-400">
        Nessun modello trovato in Ollama. Scaricane uno con{" "}
        <code className="rounded bg-black/30 px-1">ollama pull &lt;nome&gt;</code>.
      </p>
    );
  }

  return (
    <label className="flex flex-col gap-1 text-xs text-slate-300">
      Modello
      <select
        className="rounded-md border border-white/10 bg-nathion-panel px-2 py-1 text-sm text-slate-100"
        value={selectedModel ?? ""}
        onChange={(e) => onChange(e.target.value)}
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </label>
  );
}

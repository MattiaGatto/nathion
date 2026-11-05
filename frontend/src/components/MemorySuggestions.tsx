import { useState } from "react";
import { workspaceRequest } from "../api/client";
interface Suggestion { content: string; category: string; source: string; certainty: string; }
export function MemorySuggestions({ conversationId, model }: { conversationId: string; model: string | null }) {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  async function suggest() {
    setBusy(true); setError(""); setNotice(""); setItems([]);
    try {
      const result = await workspaceRequest<{ suggestions: Suggestion[] }>(`conversations/${conversationId}/memory-suggestions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model }) });
      setItems(result.suggestions); if (!result.suggestions.length) setNotice("Nessuna informazione durevole suggerita.");
    } catch (e) { setError(e instanceof Error ? e.message : "Analisi fallita"); }
    finally { setBusy(false); }
  }
  async function save(item: Suggestion) {
    setBusy(true); setError("");
    try { await workspaceRequest("memory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item) }); setItems((values) => values.filter((value) => value !== item)); setNotice("Memoria salvata come informazione da verificare."); }
    catch (e) { setError(e instanceof Error ? e.message : "Salvataggio fallito"); }
    finally { setBusy(false); }
  }
  return <div className="mb-3 space-y-2 text-xs"><button disabled={!model || busy} className="rounded-lg border border-nathion-border px-3 py-2 disabled:opacity-40" onClick={suggest}>{busy ? "Analisi…" : "Suggerisci cosa ricordare"}</button>{items.length > 0 && <p className="text-nathion-muted">Controlla ed eventualmente modifica ogni proposta. Nulla viene salvato senza il pulsante Salva. Evita informazioni sensibili.</p>}{items.map((item, index) => <div key={index} className="space-y-2 rounded border border-nathion-border p-2"><textarea aria-label={`Memoria suggerita ${index + 1}`} value={item.content} maxLength={8000} className="w-full rounded bg-nathion-panel p-2" onChange={(e) => setItems((values) => values.map((value, position) => position === index ? { ...value, content: e.target.value } : value))} /><p>{item.category} · da verificare</p><button disabled={busy || !item.content.trim()} onClick={() => save(item)}>Salva questa memoria</button><button className="ml-4" onClick={() => setItems((values) => values.filter((_, position) => position !== index))}>Scarta</button></div>)}{notice && <p role="status">{notice}</p>}{error && <p role="alert" className="text-red-300">{error}</p>}</div>;
}

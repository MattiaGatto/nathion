import { useEffect, useState } from "react";
import { workspaceRequest } from "../api/client";

interface Agent { id: string; name: string; description: string; skills: string[]; }
interface Memory { id: string; content: string; category: string; source: string; certainty: string; }
interface Run { id: string; prompt: string; status: string; result: string; trace: Record<string, unknown>[]; }
interface Props { model: string | null; onClose: () => void; }

export function WorkspacePanel({ model, onClose }: Props) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [prompt, setPrompt] = useState("");
  const [note, setNote] = useState("");
  const [category, setCategory] = useState("project");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function reload() {
    const [a, m, r] = await Promise.all([workspaceRequest<Agent[]>("agents"), workspaceRequest<Memory[]>("memory"), workspaceRequest<Run[]>("runs")]);
    setAgents(a); setMemories(m); setRuns(r);
  }
  useEffect(() => { reload().catch((e) => setError(e.message)); }, []);
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => {
      workspaceRequest<Run[]>("runs").then(setRuns).catch(() => {});
    }, 1500);
    return () => clearInterval(timer);
  }, [busy]);

  async function execute() {
    if (!model || !prompt.trim()) return;
    setError(""); setBusy(true);
    try {
      await workspaceRequest("runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, model }) });
      await reload();
    } catch (e) { setError(e instanceof Error ? e.message : "Attività fallita"); }
    finally { setBusy(false); }
  }
  async function remember() {
    setError("");
    try {
      await workspaceRequest("memory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: note, category, source: "user", certainty: "fact" }) });
      setNote(""); await reload();
    } catch (e) { setError(e instanceof Error ? e.message : "Salvataggio fallito"); }
  }
  async function forget(id: string) {
    if (!window.confirm("Eliminare definitivamente questa memoria?")) return;
    try { await workspaceRequest(`memory/${id}`, { method: "DELETE" }); await reload(); }
    catch (e) { setError(e instanceof Error ? e.message : "Eliminazione fallita"); }
  }
  const button = "rounded-lg border border-nathion-border px-3 py-2 text-sm disabled:opacity-40";
  return <section className="absolute inset-0 z-30 overflow-y-auto bg-nathion-bg p-5 text-nathion-text" aria-label="Centro di controllo">
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex items-center justify-between"><h1 className="text-xl">Centro di controllo</h1><button className={button} onClick={onClose}>Torna alla chat</button></header>
      {error && <p role="alert" className="text-red-300">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{agents.map((a) => <article key={a.id} className="rounded-xl border border-nathion-border p-4"><h2>{a.name}</h2><p className="text-sm text-nathion-muted">{a.description}</p><p className="mt-2 text-xs">Skills: {a.skills.join(", ") || "nessuna"}</p></article>)}</div>
      <section className="space-y-3"><h2 className="text-lg">Attività con agenti</h2><p className="text-sm text-nathion-muted">Descrivi il risultato desiderato. Gli specialisti vengono scelti in base alla richiesta; piano e risultati sono visibili nella timeline.</p>
        <textarea aria-label="Obiettivo attività" className="w-full rounded-xl bg-nathion-panel p-3" value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={12000} />
        <button className={button} disabled={busy || !model || !prompt.trim()} onClick={execute}>{busy ? "Attività in corso…" : "Avvia attività"}</button>
        {runs.map((run) => <article key={run.id} className="space-y-2 rounded-xl border border-nathion-border p-4"><h3>{run.prompt} · {run.status}</h3><ol className="space-y-1 text-xs text-nathion-muted">{run.trace.map((event, i) => <li key={i}>{String(event.type)} {String(event.agent ?? event.task ?? "")}</li>)}</ol>{run.result && <p className="whitespace-pre-wrap text-sm">{run.result}</p>}</article>)}
      </section>
      <section className="space-y-3"><h2 className="text-lg">Memoria personale</h2><p className="text-sm text-nathion-muted">Solo le informazioni che salvi qui entrano nella memoria degli agenti. La cronologia della chat rimane separata.</p>
        <textarea aria-label="Nuova memoria" className="w-full rounded-xl bg-nathion-panel p-3" value={note} onChange={(e) => setNote(e.target.value)} maxLength={8000} />
        <select aria-label="Categoria memoria" className="bg-nathion-panel p-2" value={category} onChange={(e) => setCategory(e.target.value)}><option value="project">Progetto</option><option value="profile">Preferenza personale</option><option value="semantic">Conoscenza</option><option value="episodic">Evento</option></select>{" "}
        <button className={button} disabled={!note.trim()} onClick={remember}>Salva memoria</button>
        {memories.map((m) => <article key={m.id} className="rounded-xl border border-nathion-border p-4"><p className="whitespace-pre-wrap">{m.content}</p><p className="mt-1 text-xs text-nathion-muted">{m.category} · {m.source} · {m.certainty}</p><button className={button} onClick={() => forget(m.id)}>Elimina</button></article>)}
      </section>
    </div>
  </section>;
}

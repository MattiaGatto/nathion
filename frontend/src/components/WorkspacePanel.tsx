import { PlanEditor, type PlannedTask } from "./PlanEditor";
import { AgentStudio, type Agent } from "./AgentStudio";
import { useAccount } from "./AccessGate";
import { AccountsPanel } from "./AccountsPanel";
import { useEffect, useState } from "react";
import { api, workspaceRequest } from "../api/client";
import { VoiceControls, type VoiceSegment } from "./VoiceControls";

interface Memory { id: string; content: string; category: string; source: string; certainty: string; }
interface Run { id: string; prompt: string; status: string; result: string; trace: Record<string, unknown>[]; }
interface Action { id: string; tool: string; status: string; payload: string; result: string; }
interface RemoteTool { name: string; description?: string; input_schema: Record<string, unknown>; }
interface ScheduleItem { id: string; prompt: string; model: string; next_run_at: string; repeat_seconds: number; enabled: boolean; last_status: string; }
interface Props { model: string | null; onClose: () => void; }

export function WorkspacePanel({ model, onClose }: Props) {
  const account = useAccount();
  const admin = account?.role === "admin";
  const [agents, setAgents] = useState<Agent[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [planned, setPlanned] = useState<PlannedTask[] | null>(null);
  const [plannedPrompt, setPlannedPrompt] = useState("");
  const [prompt, setPrompt] = useState("");
  const [targetAgent, setTargetAgent] = useState("");
  const runModel = agents.find((agent) => agent.id === targetAgent)?.model ?? model;
  const [note, setNote] = useState("");
  const [category, setCategory] = useState("project");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [actions, setActions] = useState<Action[]>([]);
  const [expression, setExpression] = useState("");
  const [calculation, setCalculation] = useState("");
  const [search, setSearch] = useState("");
  const [memoryStatus, setMemoryStatus] = useState({ model: "", total: 0, indexed: 0 });
  const [voiceProfiles, setVoiceProfiles] = useState<string[]>(["default"]);
  const [mcpServers, setMcpServers] = useState<string[]>([]);
  const [mcpServer, setMcpServer] = useState("");
  const [remoteTools, setRemoteTools] = useState<RemoteTool[]>([]);
  const [remoteTool, setRemoteTool] = useState("");
  const [remoteArguments, setRemoteArguments] = useState("{}");
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [schedulePrompt, setSchedulePrompt] = useState("");
  const [scheduleModel, setScheduleModel] = useState(model ?? "");
  const [scheduleWhen, setScheduleWhen] = useState("");
  const [scheduleInterval, setScheduleInterval] = useState(0);
  const [decidingAction, setDecidingAction] = useState<string | null>(null);
  useEffect(() => { api.voiceStatus().then((status) => setVoiceProfiles(status.profiles)).catch(() => {}); }, []);
  useEffect(() => { if (!admin) return; workspaceRequest<{ id: string; servers?: string[] }[]>("tools").then((tools) => setMcpServers(tools.find((tool) => tool.id === "mcp")?.servers ?? [])).catch(() => {}); }, []);

  async function reload() {
    const [a, m, r, t, status, jobs] = await Promise.all([workspaceRequest<Agent[]>("agents"), workspaceRequest<Memory[]>("memory"), workspaceRequest<Run[]>("runs"), (admin ? workspaceRequest<Action[]>("tools/actions") : Promise.resolve([])), workspaceRequest<{ model: string; total: number; indexed: number }>("memory-status"), (admin ? workspaceRequest<ScheduleItem[]>("schedules") : Promise.resolve([]))]);
    setAgents(a); setMemories(m); setRuns(r);
    setActions(t);
    setMemoryStatus(status);
    setSchedules(jobs);
  }
  useEffect(() => { reload().catch((e) => setError(e.message)); }, []);
  useEffect(() => {
    const timer = window.setInterval(() => {
      workspaceRequest<Run[]>("runs").then(setRuns).catch(() => {});
      (admin ? workspaceRequest<ScheduleItem[]>("schedules") : Promise.resolve([])).then(setSchedules).catch(() => {});
    }, busy ? 1500 : 5000);
    return () => clearInterval(timer);
  }, [busy]);

  async function previewPlan() {
    setBusy(true); setError("");
    try {
      const result = await workspaceRequest<{ tasks: PlannedTask[] }>("plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, model }) });
      setPlanned(result.tasks); setPlannedPrompt(prompt);
    } catch (e) { setError(e instanceof Error ? e.message : "Piano non disponibile"); }
    finally { setBusy(false); }
  }
  async function execute(usePlan = false) {
    if (!runModel || !prompt.trim() || (targetAgent && prompt.length > 8000)) return;
    setError(""); setBusy(true);
    try {
      await workspaceRequest("runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, model: runModel, ...(usePlan ? { tasks: planned } : targetAgent ? { tasks: [{ id: "direct", agent_id: targetAgent, instruction: prompt }] } : {}) }) });
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
    if (!admin) {
      if (!window.confirm("Eliminare questa memoria personale?")) return;
      try { await workspaceRequest(`memory/${id}`, { method: "DELETE" }); await reload(); }
      catch (e) { setError(e instanceof Error ? e.message : "Eliminazione fallita"); }
      return;
    }
    try { await workspaceRequest("tools/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool: "memory.delete", memory_id: id }) }); await reload(); }
    catch (e) { setError(e instanceof Error ? e.message : "Eliminazione fallita"); }
  }
  async function decide(id: string, decision: "approve" | "reject") {
    if (decidingAction) return;
    setDecidingAction(id);
    try { await workspaceRequest(`tools/actions/${id}/${decision}`, { method: "POST" }); await reload(); }
    catch (e) { setError(e instanceof Error ? e.message : "Decisione fallita"); }
    finally { setDecidingAction(null); }
  }
  async function calculate() {
    try {
      const result = await workspaceRequest<{ result: number }>("tools/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool: "calculator", expression }) });
      setCalculation(String(result.result)); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Calcolo fallito"); }
  }
  async function findMemory() {
    try { setMemories(await workspaceRequest<Memory[]>(`memory?q=${encodeURIComponent(search)}`)); }
    catch (e) { setError(e instanceof Error ? e.message : "Ricerca fallita"); }
  }
  async function confirmMemory(memory: Memory) {
    if (!window.confirm("Hai verificato questa informazione e vuoi indicarla come fatto?")) return;
    try { await workspaceRequest(`memory/${memory.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: memory.content, category: memory.category, source: memory.source, certainty: "fact" }) }); await reload(); }
    catch (e) { setError(e instanceof Error ? e.message : "Aggiornamento fallito"); }
  }
  async function editMemory(memory: Memory) {
    const content = window.prompt("Aggiorna questa memoria", memory.content);
    if (content === null || !content.trim()) return;
    try {
      await workspaceRequest(`memory/${memory.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content, category: memory.category, source: memory.source, certainty: memory.certainty }) });
      await reload();
    } catch (e) { setError(e instanceof Error ? e.message : "Aggiornamento fallito"); }
  }
  async function reindex() {
    setBusy(true);
    try { await workspaceRequest("memory/reindex", { method: "POST" }); await reload(); }
    catch (e) { setError(e instanceof Error ? e.message : "Indicizzazione fallita"); }
    finally { setBusy(false); }
  }
  function contributions(run: Run): VoiceSegment[] {
    return run.trace.filter((e) => e.type === "completed" && typeof e.result === "string").map((e) => {
      const agent = agents.find((a) => a.id === e.agent);
      return { text: String(e.result), speaker: agent?.name ?? String(e.agent), profile: agent?.voice_profile ?? "default" };
    });
  }
  async function discoverRemote(server: string) {
    setMcpServer(server); setRemoteTools([]); setRemoteTool("");
    if (!server) return;
    try {
      const tools = await workspaceRequest<RemoteTool[]>(`tools/mcp/${encodeURIComponent(server)}`);
      setRemoteTools(tools); setRemoteTool(tools[0]?.name ?? "");
    } catch (e) { setError(e instanceof Error ? e.message : "Connessione MCP fallita"); }
  }
  async function prepareRemote() {
    try {
      await workspaceRequest("tools/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool: "mcp", server: mcpServer, remote_tool: remoteTool, arguments: JSON.parse(remoteArguments) }) });
      await reload(); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Argomenti non validi"); }
  }
  async function addSchedule() {
    try {
      await workspaceRequest("schedules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: schedulePrompt, model: scheduleModel, next_run_at: new Date(scheduleWhen).toISOString(), repeat_seconds: scheduleInterval }) });
      setSchedulePrompt(""); await reload();
    } catch (e) { setError(e instanceof Error ? e.message : "Programmazione fallita"); }
  }
  async function toggleSchedule(job: ScheduleItem) {
    try { await workspaceRequest(`schedules/${job.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !job.enabled }) }); await reload(); }
    catch (e) { setError(e instanceof Error ? e.message : "Aggiornamento fallito"); }
  }
  async function removeSchedule(id: string) {
    if (!window.confirm("Eliminare questa programmazione?")) return;
    try { await workspaceRequest(`schedules/${id}`, { method: "DELETE" }); await reload(); }
    catch (e) { setError(e instanceof Error ? e.message : "Eliminazione fallita"); }
  }
  async function eraseRun(id: string) {
    if (!window.confirm("Eliminare attività, risultati e timeline?")) return;
    try { await workspaceRequest(`runs/${id}`, { method: "DELETE" }); await reload(); }
    catch (e) { setError(e instanceof Error ? e.message : "Eliminazione fallita"); }
  }
  async function eraseAction(id: string) {
    if (!window.confirm("Eliminare la registrazione? Non annulla un'operazione già eseguita.")) return;
    try { await workspaceRequest(`tools/actions/${id}`, { method: "DELETE" }); await reload(); }
    catch (e) { setError(e instanceof Error ? e.message : "Eliminazione fallita"); }
  }
  async function exportData() {
    try {
      const data = await workspaceRequest<Record<string, unknown>>("export");
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" }));
      const link = document.createElement("a"); link.href = url; link.download = "nathion-export.json";
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(e instanceof Error ? e.message : "Esportazione fallita"); }
  }
  function label(value: unknown) {
    const labels: Record<string, string> = { completed: "Completata", running: "In corso", failed: "Non riuscita", interrupted: "Interrotta al riavvio", cancelled: "Annullata", unknown: "Esito da verificare", pending: "Da approvare", executing: "In esecuzione", rejected: "Rifiutata", never: "Non ancora eseguita", plan: "Piano", started: "Avvio", tool: "Strumento", aggregating: "Sintesi", finished: "Conclusa" };
    return labels[String(value)] ?? String(value);
  }
  const button = "rounded-lg border border-nathion-border px-3 py-2 text-sm disabled:opacity-40";
  return <section className="absolute inset-0 z-30 overflow-y-auto bg-nathion-bg p-5 text-nathion-text" aria-label="Centro di controllo">
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-xl">Centro di controllo</h1><div className="flex gap-2"><button className={button} onClick={exportData}>Esporta dati</button><button className={button} onClick={onClose}>Torna alla chat</button></div></header>
      {!account?.personal_mode && <AccountsPanel />}
      {error && <p role="alert" className="text-red-300">{error}</p>}
      <AgentStudio agents={agents} voices={voiceProfiles} onSaved={(saved) => setAgents((current) =>
        current.map((agent) => agent.id === saved.id ? saved : agent))} />
      <section className="space-y-3"><h2 className="text-lg">Attività con agenti</h2><p className="text-sm text-nathion-muted">Descrivi il risultato desiderato. Gli specialisti vengono scelti in base alla richiesta; piano e risultati sono visibili nella timeline.</p>
        <label className="block text-sm">A chi assegnare l’attività
          <select value={targetAgent} onChange={(e) => { setTargetAgent(e.target.value); setPlanned(null); }}
            className="ml-2 rounded-lg border border-nathion-border bg-nathion-panel p-2">
            <option value="">Scelta automatica</option>
            {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </select>
        </label>
        <textarea aria-label="Obiettivo attività" className="w-full rounded-xl bg-nathion-panel p-3" value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={targetAgent ? 8000 : 12000} />
        {targetAgent && prompt.length > 8000 && <p className="text-xs text-amber-200">Riduci l’obiettivo a 8.000 caratteri per assegnarlo a un singolo agente.</p>}
        <button className={button} disabled={busy || !runModel || !prompt.trim() || Boolean(targetAgent && prompt.length > 8000)} onClick={() => execute()}>{busy ? "Attività in corso…" : "Avvia attività"}</button>
        <button className={button} disabled={busy || !model || !prompt.trim() || Boolean(targetAgent)} onClick={previewPlan}>Proponi piano con il modello</button>
        {planned && plannedPrompt === prompt && <div className="space-y-2 rounded-xl border border-nathion-border p-3"><p className="text-sm">Piano proposto: controlla agenti, istruzioni, strumenti e dipendenze prima di avviare. Puoi modificarlo.</p><PlanEditor tasks={planned} agents={agents} onChange={setPlanned} /><button className={button} disabled={busy} onClick={() => execute(true)}>Approva piano e avvia</button><button className={button} onClick={() => setPlanned(null)}>Scarta piano</button></div>}
        {runs.map((run) => <article key={run.id} className="space-y-2 rounded-xl border border-nathion-border p-4"><h3>{run.prompt} · {label(run.status)}</h3><ol className="space-y-1 text-xs text-nathion-muted">{run.trace.map((event, i) => <li key={i}>{label(event.type)} {String(event.agent ?? event.task ?? "")}{Array.isArray(event.sources) && event.sources.length > 0 && <span> · Fonti consultate {event.sources.map(String).join(", ")}</span>}{event.detail ? `: ${String(event.detail)}` : ""}</li>)}</ol>{run.result && <p className="whitespace-pre-wrap text-sm">{run.result}</p>}<button className={button} disabled={run.status === "running"} onClick={() => eraseRun(run.id)}>Elimina attività</button></article>)}
      </section>
      {runs.filter((run) => run.status === "completed" && contributions(run).length > 0).slice(0, 5).map((run) => <section key={run.id} className="rounded-xl border border-nathion-border p-4"><h2 className="mb-3 text-sm">Ascolta gli agenti · {run.prompt}</h2><VoiceControls disabled={true} onTranscript={() => {}} reply={run.result} segments={contributions(run)} /></section>)}
      <section className="space-y-3"><h2 className="text-lg">Memoria personale</h2><p className="text-sm text-nathion-muted">Solo le informazioni che salvi qui entrano nella memoria degli agenti. La cronologia della chat rimane separata.</p>
        <p className="text-xs text-nathion-muted">{memoryStatus.model ? `Ricerca ibrida: ${memoryStatus.indexed} informazioni indicizzate su ${memoryStatus.total}. In caso di indisponibilità del modello viene usata la ricerca per parole.` : "Ricerca per parole. Nessun modello semantico configurato."}</p>
        {memoryStatus.model && memoryStatus.indexed < memoryStatus.total && <button className={button} disabled={busy} onClick={reindex}>Indicizza informazioni mancanti</button>}
        <div className="flex gap-2"><input aria-label="Cerca nella memoria" className="min-w-0 flex-1 rounded-lg bg-nathion-panel p-3" value={search} onChange={(e) => setSearch(e.target.value)} /><button className={button} onClick={findMemory}>Cerca</button></div>
        <textarea aria-label="Nuova memoria" className="w-full rounded-xl bg-nathion-panel p-3" value={note} onChange={(e) => setNote(e.target.value)} maxLength={8000} />
        <select aria-label="Categoria memoria" className="bg-nathion-panel p-2" value={category} onChange={(e) => setCategory(e.target.value)}><option value="project">Progetto</option><option value="profile">Preferenza personale</option><option value="semantic">Conoscenza</option><option value="episodic">Evento</option></select>{" "}
        <button className={button} disabled={!note.trim()} onClick={remember}>Salva memoria</button>
        {memories.map((m) => <article key={m.id} className="rounded-xl border border-nathion-border p-4"><p className="whitespace-pre-wrap">{m.content}</p><p className="mt-1 text-xs text-nathion-muted">{m.category} · {m.source} · {m.certainty}</p>{m.certainty === "inference" && <button className={button} onClick={() => confirmMemory(m)}>Conferma come fatto</button>}{" "}<button className={button} onClick={() => editMemory(m)}>Modifica</button>{" "}<button className={button} onClick={() => forget(m.id)}>Elimina</button></article>)}
      </section>
      {admin && <><section className="space-y-3"><h2 className="text-lg">Operazioni da approvare</h2>
        {decidingAction && <p role="status" className="text-sm text-nathion-muted">Decisione in corso…</p>}
        {actions.filter((a) => a.status === "pending").map((a) => <article key={a.id} className="rounded-xl border border-nathion-border p-4">{a.tool === "mcp" ? <><p>Server {JSON.parse(a.payload).server} · {JSON.parse(a.payload).tool}</p><pre className="overflow-x-auto whitespace-pre-wrap text-xs">{JSON.stringify(JSON.parse(a.payload).arguments, null, 2)}</pre></> : <p>Eliminare la memoria: {memories.find((m) => m.id === JSON.parse(a.payload).memory_id)?.content ?? "Azzera la ricerca per rivedere la memoria interessata."}</p>}<div className="mt-3 flex gap-2"><button className={button} disabled={a.tool !== "mcp" && !memories.some((m) => m.id === JSON.parse(a.payload).memory_id)} onClick={() => decide(a.id, "approve")}>Approva esecuzione</button><button className={button} onClick={() => decide(a.id, "reject")}>Rifiuta</button></div></article>)}
        {!actions.some((a) => a.status === "pending") && <p className="text-sm text-nathion-muted">Nessuna operazione in attesa.</p>}
        {actions.filter((a) => a.status !== "pending").slice(0, 10).map((a) => <article key={a.id} className="rounded-lg border border-nathion-border p-3"><p className="text-sm">{a.tool === "mcp" ? `${JSON.parse(a.payload).server} · ${JSON.parse(a.payload).tool}` : "Operazione sulla memoria"} · {label(a.status)}</p>{a.result && <p className="mt-2 whitespace-pre-wrap text-sm">{JSON.parse(a.result).text ?? JSON.parse(a.result).detail ?? "Operazione conclusa."}</p>}{a.result && JSON.parse(a.result).truncated && <p className="text-xs text-nathion-muted">Risultato abbreviato al limite di visualizzazione.</p>}<button className={button} disabled={a.status === "executing"} onClick={() => eraseAction(a.id)}>Elimina registrazione</button></article>)}
      </section>
      <section className="space-y-3"><h2 className="text-lg">Calcolatrice locale</h2><input aria-label="Espressione aritmetica" className="rounded-lg bg-nathion-panel p-3" value={expression} onChange={(e) => setExpression(e.target.value)} maxLength={200} />{" "}<button className={button} onClick={calculate}>Calcola</button><output className="ml-3">{calculation}</output></section>
      <section className="space-y-3"><h2 className="text-lg">Attività programmate</h2><p className="text-sm text-nathion-muted">Eseguite con Ollama sul PC acceso, senza shell o chiamate MCP automatiche. I risultati compaiono nella timeline. La pausa ferma le esecuzioni future.</p><textarea aria-label="Obiettivo programmato" className="w-full rounded bg-nathion-panel p-3" maxLength={12000} value={schedulePrompt} onChange={(e) => setSchedulePrompt(e.target.value)} /><div className="flex flex-wrap gap-3"><label className="text-xs">Modello Ollama locale<input aria-label="Modello programmazione" className="ml-2 rounded bg-nathion-panel p-2" value={scheduleModel} onChange={(e) => setScheduleModel(e.target.value)} /></label><input aria-label="Data e ora locale" className="rounded bg-nathion-panel p-2" type="datetime-local" value={scheduleWhen} onChange={(e) => setScheduleWhen(e.target.value)} /><select aria-label="Ripetizione" className="rounded bg-nathion-panel p-2" value={scheduleInterval} onChange={(e) => setScheduleInterval(Number(e.target.value))}><option value={0}>Una volta</option><option value={3600}>Ogni ora</option><option value={86400}>Ogni 24 ore</option><option value={604800}>Ogni 7 giorni</option></select><button className={button} disabled={!schedulePrompt.trim() || !scheduleWhen || !scheduleModel.trim()} onClick={addSchedule}>Programma</button></div>{schedules.map((job) => <article key={job.id} className="rounded-xl border border-nathion-border p-4"><p>{job.prompt}</p><p className="my-2 text-xs text-nathion-muted">{new Date(job.next_run_at).toLocaleString("it-IT")} · {job.enabled ? "Attiva" : "In pausa / conclusa"} · Ultimo esito: {job.last_status}</p><button className={button} onClick={() => toggleSchedule(job)}>{job.enabled ? "Metti in pausa" : "Riattiva"}</button>{" "}<button className={button} onClick={() => removeSchedule(job.id)}>Elimina programmazione</button></article>)}</section>
      <section className="space-y-3"><h2 className="text-lg">Connessioni MCP</h2>{mcpServers.length === 0 ? <p className="text-sm text-nathion-muted">Nessun server configurato dal proprietario. Nessuna connessione esterna attiva.</p> : <><select aria-label="Server MCP" className="rounded bg-nathion-panel p-2" value={mcpServer} onChange={(e) => discoverRemote(e.target.value)}><option value="">Seleziona server</option>{mcpServers.map((server) => <option key={server}>{server}</option>)}</select>{" "}<select aria-label="Strumento MCP" className="rounded bg-nathion-panel p-2" value={remoteTool} onChange={(e) => setRemoteTool(e.target.value)}>{remoteTools.map((tool) => <option key={tool.name}>{tool.name}</option>)}</select><p className="text-sm">{remoteTools.find((tool) => tool.name === remoteTool)?.description}</p><textarea aria-label="Argomenti JSON strumento MCP" className="w-full rounded bg-nathion-panel p-3 font-mono text-sm" maxLength={16000} value={remoteArguments} onChange={(e) => setRemoteArguments(e.target.value)} /><button className={button} disabled={!remoteTool} onClick={prepareRemote}>Prepara richiesta da approvare</button></>}</section>
      </>}
    </div>
  </section>;
}

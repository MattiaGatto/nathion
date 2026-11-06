import { PlanEditor, type PlannedTask } from "./PlanEditor";
import { AgentStudio, type Agent } from "./AgentStudio";
import { useAccount } from "./AccessGate";
import { AccountsPanel } from "./AccountsPanel";
import { useEffect, useState } from "react";
import { api, workspaceRequest } from "../api/client";
import { VoiceControls, type VoiceSegment } from "./VoiceControls";

interface Memory { id: string; content: string; category: string; source: string; certainty: string; }
interface Run { id: string; created_at: string; prompt: string; status: string; result: string; trace: Record<string, unknown>[]; }
interface Action { id: string; tool: string; status: string; payload: string; result: string; }
interface RemoteTool { name: string; description?: string; input_schema: Record<string, unknown>; }
interface ScheduleItem { id: string; prompt: string; model: string; next_run_at: string; repeat_seconds: number; enabled: boolean; last_status: string; }
interface Props { model: string | null; onClose: () => void; }

const scheduleMaxSeconds = 30 * 86400;
const scheduleUnits = [
  { seconds: 1, label: "secondi" },
  { seconds: 60, label: "minuti" },
  { seconds: 3600, label: "ore" },
  { seconds: 86400, label: "giorni" },
  { seconds: 604800, label: "settimane" },
];

function recurrence(seconds: number) {
  if (!seconds) return "Una volta";
  const unit = [...scheduleUnits].reverse().find((item) => seconds % item.seconds === 0) ?? scheduleUnits[0];
  return `Ogni ${seconds / unit.seconds} ${unit.label}`;
}

export function WorkspacePanel({ model, onClose }: Props) {
  const account = useAccount();
  const admin = account?.role === "admin";
  const [agents, setAgents] = useState<Agent[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [section, setSection] = useState("Studio");
  const [log, setLog] = useState<Run[] | null>(null);
  const [openedRun, setOpenedRun] = useState<string | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [lastRun, setLastRun] = useState<Run | null>(null);
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
  const [scheduleUnit, setScheduleUnit] = useState(0);
  const [scheduleQuantity, setScheduleQuantity] = useState("1");
  const scheduleInterval = scheduleUnit ? Number(scheduleQuantity) * scheduleUnit : 0;
  const validScheduleInterval = !scheduleUnit || (Number.isSafeInteger(Number(scheduleQuantity)) &&
    scheduleInterval >= scheduleUnit && scheduleInterval <= scheduleMaxSeconds);
  const [decidingAction, setDecidingAction] = useState<string | null>(null);
  useEffect(() => { api.voiceStatus().then((status) => setVoiceProfiles(status.profiles)).catch(() => {}); }, []);
  useEffect(() => { if (!admin) return; workspaceRequest<{ id: string; servers?: string[] }[]>("tools").then((tools) => setMcpServers(tools.find((tool) => tool.id === "mcp")?.servers ?? [])).catch(() => {}); }, []);

  async function reload() {
    const [a, m, t, status, jobs] = await Promise.all([workspaceRequest<Agent[]>("agents"), workspaceRequest<Memory[]>("memory"), (admin ? workspaceRequest<Action[]>("tools/actions") : Promise.resolve([])), workspaceRequest<{ model: string; total: number; indexed: number }>("memory-status"), (admin ? workspaceRequest<ScheduleItem[]>("schedules") : Promise.resolve([]))]);
    setAgents(a); setMemories(m);
    setActions(t);
    setMemoryStatus(status);
    setSchedules(jobs);
  }
  useEffect(() => { reload().catch((e) => setError(e.message)); }, []);
  useEffect(() => {
    if (!admin || section !== "Automazioni") return;
    const timer = window.setInterval(() => {
      workspaceRequest<ScheduleItem[]>("schedules").then(setSchedules).catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [admin, section]);

  async function previewPlan() {
    setBusy(true); setError("");
    try {
      const result = await workspaceRequest<{ tasks: PlannedTask[] }>("plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, model }) });
      setPlanned(result.tasks); setPlannedPrompt(prompt);
    } catch (e) { setError(e instanceof Error ? e.message : "Piano non disponibile"); }
    finally { setBusy(false); }
  }
  async function execute(usePlan = false) {
    if (!runModel || !prompt.trim() || prompt.length > 24000) return;
    setError(""); setBusy(true);
    try {
      const completed = await workspaceRequest<Run>("runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, model: runModel, ...(usePlan ? { tasks: planned } : targetAgent ? { tasks: [{ id: "direct", agent_id: targetAgent, instruction: prompt }] } : {}) }) });
      setLastRun(completed);
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
    if (!validScheduleInterval) return;
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
    try { await workspaceRequest(`runs/${id}`, { method: "DELETE" }); setLog((items) => items?.filter((run) => run.id !== id) ?? null); if (lastRun?.id === id) setLastRun(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Eliminazione fallita"); }
  }
  async function eraseAction(id: string) {
    if (!window.confirm("Eliminare la registrazione? Non annulla un'operazione già eseguita.")) return;
    try { await workspaceRequest(`tools/actions/${id}`, { method: "DELETE" }); await reload(); }
    catch (e) { setError(e instanceof Error ? e.message : "Eliminazione fallita"); }
  }
  async function openLog() {
    setSection("Registro");
    setOpenedRun(null);
    setLog(null);
    setError("");
    setLogLoading(true);
    try { setLog(await workspaceRequest<Run[]>("runs/log")); }
    catch (e) { setError(e instanceof Error ? e.message : "Registro non disponibile"); }
    finally { setLogLoading(false); }
  }
  function exportLog() {
    if (!log) return;
    const json = JSON.stringify(log, null, 2);
    const phone = (window as Window & { NathionPhone?: { saveActivityLog?: (value: string) => void } }).NathionPhone;
    if (phone?.saveActivityLog) {
      if (new Blob([json]).size > 16 * 1024 * 1024) {
        setError("Il registro supera 16 MB. Esportalo dal browser sul PC.");
        return;
      }
      phone.saveActivityLog(json);
      return;
    }
    const url = URL.createObjectURL(new Blob([json], { type: "application/json;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `nathion-attivita-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function time(value: unknown) {
    if (typeof value !== "string") return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("it-IT", { dateStyle: "short", timeStyle: "medium" });
  }
  function label(value: unknown) {
    const labels: Record<string, string> = { completed: "Completata", running: "In corso", failed: "Non riuscita", interrupted: "Interrotta al riavvio", cancelled: "Annullata", unknown: "Esito da verificare", pending: "Da approvare", executing: "In esecuzione", rejected: "Rifiutata", never: "Non ancora eseguita", plan: "Piano", started: "Avvio", tool: "Strumento", aggregating: "Sintesi", finished: "Conclusa" };
    return labels[String(value)] ?? String(value);
  }
  const button = "rounded-lg border border-nathion-border px-3 py-2 text-sm disabled:opacity-40";
  return <section className="absolute inset-0 z-30 overflow-y-auto bg-nathion-bg p-3 sm:p-5 text-nathion-text" aria-label="Centro di controllo">
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="font-mono text-xs uppercase tracking-widest text-sky-300">Nathion</p><h1 className="text-xl font-semibold">Centro di controllo</h1></div>
        <div className="flex flex-wrap gap-2">
          <button className={button} disabled={logLoading} onClick={() => void openLog()}>Registro attività</button>
          <button className={button} onClick={onClose}>Torna alla chat</button>
        </div>
      </header>
      <nav aria-label="Sezioni del centro di controllo" className="flex flex-wrap gap-2 border-b border-nathion-border pb-3">
        {["Studio", "Attività", "Memoria", ...(admin ? ["Operazioni", "Automazioni", "Connessioni"] : []),
          ...(!account?.personal_mode ? ["Account"] : [])].map((item) => (
          <button key={item} type="button" aria-pressed={section === item} onClick={() => { setSection(item); setError(""); }}
            className={`${button} aria-pressed:border-sky-400/50 aria-pressed:bg-sky-400/15 aria-pressed:text-sky-100`}>{item}</button>
        ))}
      </nav>
      {section === "Account" && !account?.personal_mode && <AccountsPanel />}
      {error && <p role="alert" className="text-red-300">{error}</p>}
      {section === "Registro" && <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-lg font-semibold">Registro attività</h2><p className="text-sm text-nathion-muted">Data e ora locali, agenti coinvolti, fonti e risultati.</p></div>
          <button className={button} disabled={!log || logLoading} onClick={exportLog}>Esporta registro JSON</button>
        </div>
        {logLoading && <p role="status">Caricamento registro…</p>}
        {!logLoading && log?.length === 0 && <p className="text-sm text-nathion-muted">Nessuna attività registrata.</p>}
        {!logLoading && log?.map((run) => {
          const names = [...new Set(run.trace.filter((event) => event.type === "started")
            .map((event) => String(event.agent_name ?? agents.find((agent) => agent.id === event.agent)?.name ?? event.agent ?? "")))].filter(Boolean);
          const expanded = openedRun === run.id;
          const segments = expanded ? contributions(run) : [];
          return <article key={run.id} className="space-y-3 rounded-xl border border-nathion-border bg-nathion-panel p-4">
            <button type="button" aria-expanded={expanded} onClick={() => setOpenedRun(expanded ? null : run.id)} className="block w-full break-words text-left text-sm">
              <span className="font-medium">{run.prompt}</span>
              <span className="block text-xs text-nathion-muted">{time(run.created_at)} · {label(run.status)}{names.length > 0 ? ` · ${names.join(", ")}` : ""}</span>
            </button>
            {expanded && <>
            <ol className="space-y-2 border-l border-nathion-border pl-3 text-xs text-nathion-muted">
              {run.trace.map((event, i) => <li key={i} className="break-words">
                <time>{time(event.at)}</time> · {label(event.type)} {String(event.agent_name ?? agents.find((agent) => agent.id === event.agent)?.name ?? event.agent ?? event.task ?? "")}
                {Array.isArray(event.sources) && event.sources.length > 0 && <span> · Fonti {event.sources.map(String).join(", ")}</span>}
                {event.detail ? ` · ${String(event.detail)}` : ""}
              </li>)}
            </ol>
            {run.result && <p className="whitespace-pre-wrap break-words text-sm">{run.result}</p>}
            {run.status === "completed" && segments.length > 0 && <VoiceControls disabled={true} onTranscript={() => {}} reply={run.result} segments={segments} />}
            <button className={button} disabled={run.status === "running"} onClick={() => eraseRun(run.id)}>Elimina attività</button>
            </>}
          </article>;
        })}
      </section>}
      {section === "Studio" && <AgentStudio agents={agents} voices={voiceProfiles} onSaved={(saved) => setAgents((current) =>
        current.some((agent) => agent.id === saved.id) ? current.map((agent) => agent.id === saved.id ? saved : agent) : [...current, saved])}
        onDeleted={(id) => {
          setAgents((current) => current.filter((agent) => agent.id !== id));
          if (targetAgent === id) setTargetAgent("");
          setPlanned((current) => current?.some((task) => task.agent_id === id) ? null : current);
        }} />}
      {section === "Attività" && <section className="space-y-3"><h2 className="text-lg">Attività con agenti</h2><p className="text-sm text-nathion-muted">Descrivi il risultato desiderato. Gli specialisti vengono scelti in base alla richiesta; piano e risultati sono visibili nella timeline.</p>
        <label className="block text-sm">A chi assegnare l’attività
          <select value={targetAgent} onChange={(e) => { setTargetAgent(e.target.value); setPlanned(null); }}
            className="ml-2 rounded-lg border border-nathion-border bg-nathion-panel p-2">
            <option value="">Scelta automatica</option>
            {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </select>
        </label>
        <textarea aria-label="Obiettivo attività" className="w-full rounded-xl bg-nathion-panel p-3" value={prompt} onChange={(e) => setPrompt(e.target.value)}  />
        {prompt.length > 24000 && <p className="text-xs text-amber-200">Il limite per un’attività è di 24.000 caratteri.</p>}
        <button className={button} disabled={busy || !runModel || !prompt.trim() || prompt.length > 24000} onClick={() => execute()}>{busy ? "Attività in corso…" : "Avvia attività"}</button>
        <button className={button} disabled={busy || !model || !prompt.trim() || prompt.length > 24000 || Boolean(targetAgent)} onClick={previewPlan}>Proponi piano con il modello</button>
        {planned && plannedPrompt === prompt && <div className="space-y-2 rounded-xl border border-nathion-border p-3"><p className="text-sm">Piano proposto: controlla agenti, istruzioni, strumenti e dipendenze prima di avviare. Puoi modificarlo.</p><PlanEditor tasks={planned} agents={agents} onChange={setPlanned} /><button className={button} disabled={busy} onClick={() => execute(true)}>Approva piano e avvia</button><button className={button} onClick={() => setPlanned(null)}>Scarta piano</button></div>}
        {lastRun && <article className="space-y-2 rounded-xl border border-nathion-border p-4">
          <h3>Ultima attività · {label(lastRun.status)}</h3>
          {lastRun.result && <p className="whitespace-pre-wrap break-words text-sm">{lastRun.result}</p>}
          {lastRun.status !== "completed" && <button className={button} onClick={() => void openLog()}>Vedi dettagli</button>}
        </article>}
      </section>}
      {section === "Memoria" && <section className="space-y-3"><h2 className="text-lg">Memoria personale</h2><p className="text-sm text-nathion-muted">Qui puoi salvare note riutilizzabili. La bio del profilo si gestisce da Impostazioni. La cronologia della chat rimane separata.</p>
        <p className="text-xs text-nathion-muted">{memoryStatus.model ? `Ricerca ibrida: ${memoryStatus.indexed} informazioni indicizzate su ${memoryStatus.total}. In caso di indisponibilità del modello viene usata la ricerca per parole.` : "Ricerca per parole. Nessun modello semantico configurato."}</p>
        {memoryStatus.model && memoryStatus.indexed < memoryStatus.total && <button className={button} disabled={busy} onClick={reindex}>Indicizza informazioni mancanti</button>}
        <div className="flex gap-2"><input aria-label="Cerca nella memoria" className="min-w-0 flex-1 rounded-lg bg-nathion-panel p-3" value={search} onChange={(e) => setSearch(e.target.value)} /><button className={button} onClick={findMemory}>Cerca</button></div>
        <textarea aria-label="Nuova memoria" className="w-full rounded-xl bg-nathion-panel p-3" value={note} onChange={(e) => setNote(e.target.value)} maxLength={24000} />
        <select aria-label="Categoria memoria" className="bg-nathion-panel p-2" value={category} onChange={(e) => setCategory(e.target.value)}><option value="project">Progetto</option><option value="profile">Preferenza personale</option><option value="semantic">Conoscenza</option><option value="episodic">Evento</option></select>{" "}
        <button className={button} disabled={!note.trim()} onClick={remember}>Salva memoria</button>
        {memories.map((m) => <article key={m.id} className="rounded-xl border border-nathion-border p-4"><p className="whitespace-pre-wrap">{m.content}</p><p className="mt-1 text-xs text-nathion-muted">{m.category} · {m.source} · {m.certainty}</p>{m.certainty === "inference" && <button className={button} onClick={() => confirmMemory(m)}>Conferma come fatto</button>}{" "}<button className={button} onClick={() => editMemory(m)}>Modifica</button>{" "}<button className={button} onClick={() => forget(m.id)}>Elimina</button></article>)}
      </section>}
      {admin && section === "Operazioni" && <section className="space-y-3"><h2 className="text-lg">Operazioni da approvare</h2>
        {decidingAction && <p role="status" className="text-sm text-nathion-muted">Decisione in corso…</p>}
        {actions.filter((a) => a.status === "pending").map((a) => <article key={a.id} className="rounded-xl border border-nathion-border p-4">{a.tool === "mcp" ? <><p>Server {JSON.parse(a.payload).server} · {JSON.parse(a.payload).tool}</p><pre className="overflow-x-auto whitespace-pre-wrap text-xs">{JSON.stringify(JSON.parse(a.payload).arguments, null, 2)}</pre></> : <p>Eliminare la memoria: {memories.find((m) => m.id === JSON.parse(a.payload).memory_id)?.content ?? "Azzera la ricerca per rivedere la memoria interessata."}</p>}<div className="mt-3 flex gap-2"><button className={button} disabled={a.tool !== "mcp" && !memories.some((m) => m.id === JSON.parse(a.payload).memory_id)} onClick={() => decide(a.id, "approve")}>Approva esecuzione</button><button className={button} onClick={() => decide(a.id, "reject")}>Rifiuta</button></div></article>)}
        {!actions.some((a) => a.status === "pending") && <p className="text-sm text-nathion-muted">Nessuna operazione in attesa.</p>}
        {actions.filter((a) => a.status !== "pending").slice(0, 10).map((a) => <article key={a.id} className="rounded-lg border border-nathion-border p-3"><p className="text-sm">{a.tool === "mcp" ? `${JSON.parse(a.payload).server} · ${JSON.parse(a.payload).tool}` : "Operazione sulla memoria"} · {label(a.status)}</p>{a.result && <p className="mt-2 whitespace-pre-wrap text-sm">{JSON.parse(a.result).text ?? JSON.parse(a.result).detail ?? "Operazione conclusa."}</p>}{a.result && JSON.parse(a.result).truncated && <p className="text-xs text-nathion-muted">Risultato abbreviato al limite di visualizzazione.</p>}<button className={button} disabled={a.status === "executing"} onClick={() => eraseAction(a.id)}>Elimina registrazione</button></article>)}
      </section>}
      {admin && section === "Automazioni" && <section className="space-y-3"><h2 className="text-lg">Attività programmate</h2><p className="text-sm text-nathion-muted">Eseguite con Ollama sul PC acceso, senza shell o chiamate MCP automatiche. I risultati compaiono nella timeline. Intervallo massimo 30 giorni. Le esecuzioni sono sequenziali. La pausa ferma quelle future.</p><textarea aria-label="Obiettivo programmato" className="w-full rounded bg-nathion-panel p-3" maxLength={24000} value={schedulePrompt} onChange={(e) => setSchedulePrompt(e.target.value)} /><div className="flex flex-wrap gap-3"><label className="text-xs">Modello Ollama locale<input aria-label="Modello programmazione" className="ml-2 rounded bg-nathion-panel p-2" value={scheduleModel} onChange={(e) => setScheduleModel(e.target.value)} /></label><input aria-label="Data e ora locale" className="rounded bg-nathion-panel p-2" type="datetime-local" step={1} value={scheduleWhen} onChange={(e) => setScheduleWhen(e.target.value)} /><label className="text-xs">Ripetizione
        <select aria-label="Unità della ripetizione" className="ml-2 rounded bg-nathion-panel p-2" value={scheduleUnit}
          onChange={(e) => setScheduleUnit(Number(e.target.value))}>
          <option value={0}>Una volta</option>
          {scheduleUnits.map((unit) => <option key={unit.seconds} value={unit.seconds}>Ogni … {unit.label}</option>)}
        </select></label>
        {scheduleUnit > 0 && <label className="text-xs">Quantità
          <input aria-label="Quantità della ripetizione" className="ml-2 w-24 rounded bg-nathion-panel p-2"
            type="number" min={1} max={Math.floor(scheduleMaxSeconds / scheduleUnit)} step={1} value={scheduleQuantity}
            onChange={(e) => setScheduleQuantity(e.target.value)} />
        </label>}
        {!validScheduleInterval && <p role="alert" className="text-xs text-amber-200">Inserisci un intervallo intero fino a 30 giorni.</p>}
        <button className={button} disabled={!schedulePrompt.trim() || !scheduleWhen || !scheduleModel.trim() || !validScheduleInterval} onClick={addSchedule}>Programma</button></div>{schedules.map((job) => <article key={job.id} className="rounded-xl border border-nathion-border p-4"><p>{job.prompt}</p><p className="my-2 text-xs text-nathion-muted">{new Date(job.next_run_at).toLocaleString("it-IT")} · {job.enabled ? "Attiva" : "In pausa / conclusa"} · {recurrence(job.repeat_seconds)} · Ultimo esito: {job.last_status}</p><button className={button} onClick={() => toggleSchedule(job)}>{job.enabled ? "Metti in pausa" : "Riattiva"}</button>{" "}<button className={button} onClick={() => removeSchedule(job.id)}>Elimina programmazione</button></article>)}</section>}
      {admin && section === "Connessioni" && <section className="space-y-3"><h2 className="text-lg">Connessioni MCP</h2>{mcpServers.length === 0 ? <p className="text-sm text-nathion-muted">Nessun server configurato dal proprietario. Nessuna connessione esterna attiva.</p> : <><select aria-label="Server MCP" className="rounded bg-nathion-panel p-2" value={mcpServer} onChange={(e) => discoverRemote(e.target.value)}><option value="">Seleziona server</option>{mcpServers.map((server) => <option key={server}>{server}</option>)}</select>{" "}<select aria-label="Strumento MCP" className="rounded bg-nathion-panel p-2" value={remoteTool} onChange={(e) => setRemoteTool(e.target.value)}>{remoteTools.map((tool) => <option key={tool.name}>{tool.name}</option>)}</select><p className="text-sm">{remoteTools.find((tool) => tool.name === remoteTool)?.description}</p><textarea aria-label="Argomenti JSON strumento MCP" className="w-full rounded bg-nathion-panel p-3 font-mono text-sm" maxLength={16000} value={remoteArguments} onChange={(e) => setRemoteArguments(e.target.value)} /><button className={button} disabled={!remoteTool} onClick={prepareRemote}>Prepara richiesta da approvare</button></>}</section>}
    </div>
  </section>;
}

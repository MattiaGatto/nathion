import { useEffect, useState, type FormEvent } from "react";
import { workspaceRequest } from "../api/client";

interface Skill { name: string; instructions: string; }
interface Source { id: string; name: string; characters: number; preview: string; }
export interface Agent {
  id: string;
  custom: boolean;
  name: string;
  description: string;
  job_role?: string | null;
  skills: string[];
  custom_skills: Skill[];
  tools?: string[];
  model: string | null;
  memory_access: "read" | "none";
  timeout_seconds: number;
  voice_profile: string;
}

const profileLimit = 32000;
const skillLimit = 16000;
const skillCount = 12;
const documentCount = 24;
const documentMB = 8;

function CharacterCount({ value, limit }: { value: string; limit: number }) {
  return <span className={`block text-right text-xs ${value.length > limit ? "text-red-300" : "text-nathion-muted"}`}>
    {value.length.toLocaleString("it-IT")} / {limit.toLocaleString("it-IT")} caratteri
  </span>;
}

const input = "mt-1 w-full rounded-lg border border-nathion-border bg-nathion-bg p-2.5 text-sm text-nathion-text";
const button = "rounded-lg border border-sky-400/30 px-3 py-2 text-sm text-sky-200 hover:bg-sky-400/10 disabled:opacity-40";

export function AgentStudio({ agents, voices, onSaved, onDeleted }: {
  agents: Agent[];
  voices: string[];
  onSaved: (agent: Agent) => void;
  onDeleted: (id: string) => void;
}) {
  const [selected, setSelected] = useState("");
  const [creating, setCreating] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const agent = agents.find((item) => item.id === selected) ?? agents[0];
  return (
    <section className="overflow-hidden rounded-2xl border border-sky-400/25 bg-nathion-panel" aria-labelledby="agent-studio-title">
      <header className="border-b border-sky-400/20 bg-gradient-to-r from-sky-950/70 to-nathion-panel p-5 sm:p-7">
        <p className="font-mono text-[11px] uppercase tracking-[.28em] text-sky-300">Nathion · Configurazione</p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h2 id="agent-studio-title" className="text-2xl font-semibold">Studio agenti</h2>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={button} onClick={() => { setPresetsOpen(!presetsOpen); setCreating(false); }}>Preset</button>
            <button type="button" className={button} onClick={() => { setCreating(true); setPresetsOpen(false); }}>+ Nuovo agente</button>
          </div>
        </div>
        <p className="mt-2 max-w-2xl text-sm text-nathion-muted">Scegli uno specialista. Le skill guidano il suo lavoro. I documenti sono fonti consultabili solo da questo agente quando sono pertinenti.</p>
      </header>
      {creating && <NewAgent onCancel={() => setCreating(false)} onCreated={(created) => {
        onSaved(created);
        setSelected(created.id);
        setCreating(false);
      }} />}
      {presetsOpen && <AgentPresets onRestore={(restored) => {
        onSaved(restored);
        setSelected(restored.id);
        setPresetsOpen(false);
      }} />}
      {!creating && !presetsOpen && (agent ? (
        <div className="grid md:grid-cols-[15rem_minmax(0,1fr)]">
          <nav aria-label="Scegli un agente" className="grid content-start gap-1 border-b border-nathion-border p-3 sm:grid-cols-2 md:grid-cols-1 md:border-b-0 md:border-r">
            {agents.map((item, index) => (
              <button key={item.id} type="button" aria-pressed={item.id === agent.id} onClick={() => setSelected(item.id)}
                className="flex items-center gap-3 rounded-lg border border-transparent p-2.5 text-left text-sm hover:bg-sky-400/5 aria-pressed:border-sky-400/35 aria-pressed:bg-sky-400/10">
                <span aria-hidden="true" className="font-mono text-xs text-sky-300">{String(index + 1).padStart(2, "0")}</span>
                <span className="min-w-0 break-words">{item.name}<small className="block text-nathion-muted">{item.job_role || "Ruolo da definire"}</small>{item.custom && <small className="mt-1 inline-block rounded bg-violet-400/15 px-1.5 text-violet-200">Personale</small>}</span>
              </button>
            ))}
          </nav>
          <AgentEditor key={agent.id} agent={agent} voices={voices} onSaved={onSaved} onDeleted={onDeleted} />
        </div>
      ) : <p className="p-5 text-sm text-nathion-muted">Nessun agente attivo. Aggiungi un agente o scegli un preset.</p>)}
    </section>
  );
}

type Preset = Pick<Agent, "id" | "name" | "description" | "job_role">;

function AgentPresets({ onRestore }: { onRestore: (agent: Agent) => void }) {
  const [presets, setPresets] = useState<Preset[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    workspaceRequest<Preset[]>("agents/presets", { signal: controller.signal })
      .then(setPresets).catch((err) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, []);
  async function restore(id: string) {
    setBusy(true); setError("");
    try { onRestore(await workspaceRequest<Agent>(`agents/presets/${id}`, { method: "POST" })); }
    catch (err) { setError(err instanceof Error ? err.message : "Preset non disponibile."); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3 p-5" aria-label="Preset agenti">
    <h3 className="text-xl font-semibold">Preset disponibili</h3>
    {!presets && !error && <p role="status">Caricamento…</p>}
    {presets?.length === 0 && <p className="text-sm text-nathion-muted">Tutti i preset sono già attivi.</p>}
    {presets?.map((preset) => <article key={preset.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-nathion-border p-3">
      <div><h4>{preset.name}</h4><p className="text-sm text-sky-200">{preset.job_role}</p><p className="text-xs text-nathion-muted">{preset.description}</p></div>
      <button type="button" className={button} disabled={busy} onClick={() => void restore(preset.id)}>Aggiungi preset</button>
    </article>)}
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
  </section>;
}

function NewAgent({ onCreated, onCancel }: { onCreated: (agent: Agent) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [jobRole, setJobRole] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const agent = await workspaceRequest<Agent>("agents", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim(), job_role: jobRole.trim() || null }),
      });
      onCreated(agent);
    } catch (err) { setError(err instanceof Error ? err.message : "Creazione non riuscita."); }
    finally { setBusy(false); }
  }

  return <form onSubmit={submit} className="space-y-4 p-5 sm:p-7">
    <h3 className="text-xl font-semibold text-violet-200">Crea un agente personale</h3>
    <p className="text-sm text-nathion-muted">Scegli un nome facile da pronunciare. Dopo la creazione puoi aggiungere skill e documenti.</p>
    <label className="block text-sm">Nome<input className={input} autoFocus required minLength={2} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Vega" /></label>
    <label className="block text-sm">Ruolo<input className={input} value={jobRole} onChange={(e) => setJobRole(e.target.value)} maxLength={100} placeholder="Senior AI Engineer & AI Architect" /></label>
    <label className="block text-sm">Profilo e istruzioni<textarea className={input} required rows={8} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Incolla qui il profilo completo dell’agente" /><CharacterCount value={description} limit={profileLimit} /></label>
    <div className="flex gap-3">
      <button className={button} disabled={busy || name.trim().length < 2 || !description.trim() || description.length > profileLimit}>Crea agente</button>
      <button type="button" className={button} disabled={busy} onClick={onCancel}>Annulla</button>
    </div>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
  </form>;
}

function AgentEditor({ agent, voices, onSaved, onDeleted }: {
  agent: Agent;
  voices: string[];
  onSaved: (agent: Agent) => void;
  onDeleted: (id: string) => void;
}) {
  const [tab, setTab] = useState("Profilo");
  const [name, setName] = useState(agent.name);
  const [description, setDescription] = useState(agent.description);
  const [jobRole, setJobRole] = useState(agent.job_role ?? "");
  const [model, setModel] = useState(agent.model ?? "");
  const [voice, setVoice] = useState(agent.voice_profile);
  const [memory, setMemory] = useState(agent.memory_access);
  const [skills, setSkills] = useState(agent.custom_skills);
  const [documents, setDocuments] = useState<Source[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const path = `agents/${agent.id}`;

  useEffect(() => {
    const controller = new AbortController();
    workspaceRequest<Source[]>(`${path}/documents`, { signal: controller.signal })
      .then(setDocuments).catch((err) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [path]);

  async function change(action: () => Promise<string>) {
    setBusy(true); setNotice(""); setError("");
    try { setNotice(await action()); }
    catch (err) { setError(err instanceof Error ? err.message : "Operazione non riuscita."); }
    finally { setBusy(false); }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void change(async () => {
      const saved = await workspaceRequest<Agent>(path, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tab === "Skill"
          ? { custom_skills: skills.map(({ name, instructions }) => ({ name: name.trim(), instructions: instructions.trim() })) }
          : { model: model.trim() || null, voice_profile: voice, memory_access: memory,
            ...(agent.custom ? { identity: { name: name.trim(), description: description.trim(), job_role: jobRole.trim() || null } } : {}) }),
      });
      onSaved(saved);
      return "Configurazione salvata.";
    });
  }

  function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    const form = event.currentTarget;
    void change(async () => {
      if (file.size > documentMB * 1024 * 1024) throw new Error(`Il file supera ${documentMB} MB.`);
      const document = await workspaceRequest<Source>(`${path}/documents?name=${encodeURIComponent(file.name)}`,
        { method: "POST", body: file });
      setDocuments((previous) => [document, ...previous]);
      setFile(null); form.reset();
      return "Documento aggiunto. Gli estratti pertinenti saranno disponibili nelle prossime attività.";
    });
  }

  function remove(source: Source) {
    if (!window.confirm(`Rimuovere «${source.name}» dalla memoria dell’agente?`)) return;
    void change(async () => {
      await workspaceRequest(`${path}/documents/${source.id}`, { method: "DELETE" });
      setDocuments((previous) => previous.filter((item) => item.id !== source.id));
      return "Documento rimosso.";
    });
  }

  function removeAgent() {
    const restoreInfo = agent.custom ? "" : " Potrai aggiungerlo di nuovo dai preset con la configurazione iniziale.";
    if (!window.confirm(`Eliminare «${agent.name}», le personalizzazioni e i documenti?${restoreInfo}`)) return;
    void change(async () => {
      await workspaceRequest(path, { method: "DELETE" });
      onDeleted(agent.id);
      return "Agente eliminato.";
    });
  }

  function editSkill(index: number, field: keyof Skill, value: string) {
    setSkills((previous) => previous.map((skill, i) => i === index ? { ...skill, [field]: value } : skill));
  }

  return (
    <div className="min-w-0 space-y-6 p-4 sm:p-6">
      <header>
        <h3 className="text-xl font-semibold">{agent.name}</h3>
        <p className="mt-1 text-sm font-medium text-violet-200">{agent.job_role || "Ruolo da definire"}</p>
        {agent.custom && <span className="mt-1 inline-block rounded bg-violet-400/15 px-1.5 text-xs text-violet-200">Personale</span>}
        <p className="mt-1 line-clamp-2 break-words text-sm text-nathion-muted">{agent.description}</p>
      </header>

      <p className="rounded-lg border border-violet-400/25 bg-violet-400/10 p-3 text-sm text-violet-200">
        Di’ «Ehi Nathion, chiedi a {agent.name} di …»
      </p>
      <nav aria-label="Sezioni dell’agente" className="flex flex-wrap gap-2 border-b border-nathion-border pb-3">
        {["Profilo", "Skill", "Documenti"].map((item) => <button key={item} type="button" aria-pressed={tab === item} onClick={() => setTab(item)}
          className="rounded-lg border border-nathion-border px-3 py-2 text-sm aria-pressed:border-violet-400/50 aria-pressed:bg-violet-400/15 aria-pressed:text-violet-100">{item}</button>)}
      </nav>
      <form onSubmit={save} className={tab === "Documenti" ? "hidden" : "space-y-5"}>
        <div className={tab === "Profilo" ? "space-y-4" : "hidden"}>
        {agent.custom && <div className="grid gap-3">
          <label className="text-sm">Nome<input className={input} required={tab === "Profilo"} minLength={2} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="text-sm">Ruolo<input className={input} value={jobRole} onChange={(e) => setJobRole(e.target.value)} maxLength={100} placeholder="Senior AI Engineer & AI Architect" /></label>
          <label className="text-sm">Profilo e istruzioni<textarea className={input} required={tab === "Profilo"} rows={8} value={description} onChange={(e) => setDescription(e.target.value)} /><CharacterCount value={description} limit={profileLimit} /></label>
        </div>}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Modello<input className={input} value={model} onChange={(e) => setModel(e.target.value)} maxLength={200} placeholder="Usa il modello della chat" /></label>
          <label className="text-sm">Voce<select className={input} value={voice} onChange={(e) => setVoice(e.target.value)}>
            {!voices.includes(voice) && <option value={voice}>{voice} · Non disponibile</option>}
            {voices.map((profile) => <option key={profile} value={profile}>{profile === "default" ? "Paola" : profile === "ugo" ? "Ugo · qualità media" : profile}</option>)}
          </select></label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={memory === "read"} onChange={(e) => setMemory(e.target.checked ? "read" : "none")} />
          Consenti l’uso delle fonti e della memoria personale
        </label>
        </div>
        <section className={tab === "Skill" ? "space-y-3 rounded-xl border border-nathion-border p-4" : "hidden"} aria-label="Skill">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-medium">Skill operative</h4>
            <button type="button" className={button} disabled={busy || skills.length >= skillCount}
              onClick={() => setSkills([...skills, { name: "", instructions: "" }])}>Aggiungi skill</button>
          </div>
          <p className="text-sm text-nathion-muted">Definisci metodo, criteri e formato della risposta. Puoi salvare fino a {skillCount} skill personali.</p>
          {agent.skills.length > 0 && <div className="flex flex-wrap gap-2">{agent.skills.map((skill) =>
            <span key={skill} className="rounded-full bg-sky-400/10 px-2.5 py-1 font-mono text-xs text-sky-200">{skill} · integrata</span>)}</div>}
          {skills.map((skill, index) => <fieldset key={index} className="space-y-2 rounded-lg bg-nathion-surface p-3">
            <legend className="px-1 text-xs text-sky-200">Skill {index + 1}</legend>
            <label className="block text-sm">Nome<input className={input} value={skill.name} maxLength={80} required={tab === "Skill"} onChange={(e) => editSkill(index, "name", e.target.value)} /></label>
            <label className="block text-sm">Istruzioni<textarea className={input} value={skill.instructions} rows={6} required={tab === "Skill"} onChange={(e) => editSkill(index, "instructions", e.target.value)} placeholder="Per esempio, chiudi ogni revisione con tre prossimi passi." /><CharacterCount value={skill.instructions} limit={skillLimit} /></label>
            <button type="button" className="text-xs text-red-300" disabled={busy} onClick={() => setSkills(skills.filter((_, i) => i !== index))}>Rimuovi skill</button>
          </fieldset>)}
        </section>
        <button className={button} disabled={busy || (tab === "Profilo" && description.length > profileLimit) || (tab === "Skill" && skills.some((skill) => !skill.name.trim() || !skill.instructions.trim() || skill.instructions.length > skillLimit))}>{tab === "Skill" ? "Salva skill" : "Salva profilo agente"}</button>
      </form>

      <section className={tab === "Documenti" ? "space-y-3" : "hidden"} aria-label="Memoria documentale">
        <h4 className="font-medium">Memoria documentale</h4>
        <p className="text-sm text-nathion-muted">PDF con testo, DOCX, TXT, Markdown e CSV. Fino a {documentCount} file da {documentMB} MB per agente. Gli estratti vengono passati al modello scelto per l’attività.</p>
        {agent.memory_access === "none" && <p className="text-sm text-amber-200">L’agente può conservare i documenti. Riattiva la memoria per usarli nelle attività.</p>}
        <form onSubmit={upload} className="flex flex-wrap items-center gap-2">
          <input aria-label="Documento da allegare" type="file" accept=".pdf,.docx,.txt,.md,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="max-w-full min-w-0 text-xs file:mr-2 file:rounded-md file:border-0 file:bg-sky-400/10 file:px-2 file:py-1.5 file:text-sky-200" />
          <button className={button} disabled={busy || !file || documents.length >= documentCount}>Allega documento</button>
        </form>
        {documents.length === 0 && <p className="text-sm text-nathion-muted">Nessuna fonte allegata.</p>}
        {documents.map((source) => (
          <div key={source.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-nathion-border p-3">
            <details className="min-w-0 flex-1 text-sm">
              <summary className="cursor-pointer break-all text-sky-200">{source.name}</summary>
              <p className="mt-1 text-xs text-nathion-muted">{source.characters.toLocaleString("it-IT")} caratteri estratti · Anteprima</p>
              <p className="mt-2 whitespace-pre-wrap break-words text-xs">{source.preview}</p>
            </details>
            <button type="button" className="text-xs text-red-300" disabled={busy} onClick={() => remove(source)}>Rimuovi</button>
          </div>
        ))}
      </section>
      {tab === "Profilo" && <button type="button" className="text-left text-sm text-red-300" disabled={busy} onClick={removeAgent}>Elimina agente</button>}
      {busy && <p role="status" className="text-sm text-sky-200">Operazione in corso…</p>}
      {notice && <p role="status" className="text-sm text-sky-200">{notice}</p>}
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    </div>
  );
}

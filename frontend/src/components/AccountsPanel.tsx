import { useEffect, useState } from "react";
import { api, workspaceRequest } from "../api/client";
import { PasswordForm, useAccount, type Account } from "./AccessGate";
interface User extends Account { status: string; }
interface Invite { id: string; label: string; expires_at: string; revoked: boolean; used: boolean; }
const button = "rounded-lg border border-nathion-border px-3 py-2 text-sm disabled:opacity-40";
const field = "rounded bg-nathion-panel p-2";

function UserEditor({ user, models, onSaved }: { user: User; models: string[]; onSaved: () => Promise<void> }) {
  const [status, setStatus] = useState(user.status);
  const [hosting, setHosting] = useState(user.hosted_access);
  const [allowed, setAllowed] = useState(user.allowed_models);
  const [limit, setLimit] = useState(user.daily_limit);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [temporary, setTemporary] = useState("");
  async function save() {
    setBusy(true); setError("");
    try { await workspaceRequest(`auth/admin/users/${user.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, hosted_access: hosting, allowed_models: allowed, daily_limit: limit }) }); await onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : "Salvataggio fallito"); }
    finally { setBusy(false); }
  }
  async function exportUser() {
    try {
      const data = await workspaceRequest(`auth/admin/users/${user.id}/export`);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `nathion-${user.username}.json`; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(e instanceof Error ? e.message : "Esportazione fallita"); }
  }
  async function manage(action: "password" | "erase-data") {
    if (!window.confirm(action === "password" ? `Creare una password temporanea per ${user.username}?` : `Eliminare definitivamente chat, memoria e attivit� di ${user.username}?`)) return;
    setBusy(true); setError("");
    try {
      const result = await workspaceRequest<{ temporary_password?: string }>(`auth/admin/users/${user.id}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: user.username }) });
      if (result.temporary_password) setTemporary(result.temporary_password);
    } catch (e) { setError(e instanceof Error ? e.message : "Operazione fallita"); }
    finally { setBusy(false); }
  }
  if (user.role === "admin") return <p>{user.display_name} · {user.username} · Amministratore</p>;
  return <article className="space-y-3 rounded-xl border border-nathion-border p-4"><h3>{user.display_name} · {user.username}</h3><div className="flex flex-wrap gap-3"><label>Account <select className={field} value={status} onChange={(e) => setStatus(e.target.value)}><option value="pending">In attesa</option><option value="active">Approvato</option><option value="disabled">Sospeso</option></select></label><label><input type="checkbox" checked={hosting} onChange={(e) => setHosting(e.target.checked)} /> Usa i modelli di questo PC</label><label>Richieste al giorno <input aria-label={`Quota ${user.username}`} type="number" min={0} max={1000} className={field + " w-24"} value={limit} onChange={(e) => setLimit(Number(e.target.value))} /></label></div><fieldset className="flex flex-wrap gap-3"><legend className="mb-2 text-sm">Modelli Ollama consentiti</legend>{Array.from(new Set([...models, ...allowed])).map((model) => <label key={model} className="text-xs"><input type="checkbox" checked={allowed.includes(model)} onChange={(e) => setAllowed(e.target.checked ? [...allowed, model] : allowed.filter((item) => item !== model))} /> {model}</label>)}</fieldset><button className={button} disabled={busy} onClick={save}>Salva autorizzazioni</button><div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={exportUser}>Esporta dati utente</button><button className={button} disabled={busy} onClick={() => manage("password")}>Reimposta password</button><button className={button} disabled={busy || user.status !== "disabled"} onClick={() => manage("erase-data")}>Elimina dati utente sospeso</button></div>{temporary && <label className="block text-sm">Password temporanea da consegnare in privato<input className={field + " mt-2 w-full"} readOnly type="password" value={temporary} onFocus={(e) => { e.target.type = "text"; e.target.select(); }} onBlur={(e) => { e.target.type = "password"; }} /></label>}<p className="text-xs text-nathion-muted">Le sessioni aperte verranno revocate. L'utente dovrà accedere di nuovo.</p>{error && <p role="alert" className="text-red-300">{error}</p>}</article>;
}

export function AccountsPanel() {
  const account = useAccount();
  const admin = account?.role === "admin";
  const [users, setUsers] = useState<User[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [label, setLabel] = useState("");
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function reload() {
    const [people, invitations] = await Promise.all([workspaceRequest<User[]>("auth/admin/users"), workspaceRequest<Invite[]>("auth/admin/invitations")]);
    setUsers(people); setInvites(invitations);
  }
  useEffect(() => {
    if (!admin) return;
    reload().catch((e) => setError(e.message));
    api.listModels("ollama").then((items) => setModels(items.map((m) => m.id))).catch((e) => setError(e.message));
  }, [admin]);
  async function invite() {
    setError(""); setBusy(true);
    try {
      const result = await workspaceRequest<{ token: string }>("auth/admin/invitations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label, days: 7 }) });
      setLink(`${window.location.origin}/#invite=${encodeURIComponent(result.token)}`); setLabel(""); await reload();
    } catch (e) { setError(e instanceof Error ? e.message : "Invito fallito"); }
    finally { setBusy(false); }
  }
  async function revoke(id: string) {
    try { await workspaceRequest(`auth/admin/invitations/${id}`, { method: "DELETE" }); await reload(); }
    catch (e) { setError(e instanceof Error ? e.message : "Revoca fallita"); }
  }
  return <section className="space-y-4 rounded-xl border border-nathion-border p-4"><h2 className="text-lg">Account · {account?.display_name}</h2><PasswordForm onChanged={() => window.location.reload()} />{admin && <><h2 className="pt-4 text-lg">Utenti e accesso al server</h2><p className="text-sm text-nathion-muted">Ogni persona ha chat e memoria separate. Un invito crea un account in attesa: approva l'account, abilita il server e scegli i modelli. La quota conta ogni chiamata agli agenti, ogni operazione vocale e ogni embedding. L'accesso Tailscale va autorizzato separatamente.</p>{users.map((user) => <UserEditor key={JSON.stringify(user)} user={user} models={models} onSaved={reload} />)}<label className="block">Invito personale valido 7 giorni<input className={field + " ml-2"} aria-label="Etichetta invito" placeholder="Nome della persona" value={label} maxLength={100} onChange={(e) => setLabel(e.target.value)} /></label><button className={button} disabled={busy || !label.trim()} onClick={invite}>Crea invito</button>{link && <label className="block text-sm">Copia e condividi questo link in privato (mostrato una sola volta)<input className={field + " mt-2 w-full"} readOnly value={link} onFocus={(e) => e.target.select()} /><span className="text-xs text-nathion-muted">Per un telefono usa l'indirizzo HTTPS privato, non localhost.</span></label>}<ul className="space-y-2">{invites.map((item) => <li key={item.id} className="text-sm">{item.label} · {item.used ? "Utilizzato" : item.revoked ? "Revocato" : `Scade ${new Date(item.expires_at).toLocaleDateString("it-IT")}`} {!item.revoked && !item.used && <button className={button + " ml-2"} onClick={() => revoke(item.id)}>Revoca</button>}</li>)}</ul></>}{error && <p role="alert" className="text-red-300">{error}</p>}</section>;
}

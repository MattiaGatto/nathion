import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { workspaceRequest } from "../api/client";

export interface Account { id: string; username: string; display_name: string; role: string; hosted_access: boolean; allowed_models: string[]; daily_limit: number; must_change_password: boolean; }
const AccountContext = createContext<Account | null>(null);
export const useAccount = () => useContext(AccountContext);
const input = "mt-2 w-full rounded-lg bg-nathion-bg p-3";
const button = "rounded-lg border border-nathion-border px-4 py-2 disabled:opacity-40";

export function PasswordForm({ onChanged }: { onChanged: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError("");
    if (next !== confirm) { setError("Le nuove password non coincidono."); return; }
    setBusy(true);
    try {
      await workspaceRequest("auth/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current_password: current, new_password: next }) });
      setCurrent(""); setNext(""); setConfirm(""); onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : "Cambio password fallito"); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="space-y-3"><h2 className="text-lg">Cambia password</h2><p className="text-sm text-nathion-muted">Almeno 12 caratteri. Le altre sessioni verranno chiuse.</p><label className="block">Password attuale<input className={input} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required maxLength={200} /></label><label className="block">Nuova password<input className={input} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={12} maxLength={200} /></label><label className="block">Ripeti nuova password<input className={input} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={12} maxLength={200} /></label><button className={button} disabled={busy}>Salva password</button>{error && <p role="alert" className="text-red-300">{error}</p>}</form>;
}

export function AccessGate({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState("mattia");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [invitation] = useState(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get("invite") ?? "";
    if (value) window.history.replaceState(null, "", window.location.pathname + window.location.search);
    return value;
  });
  const [registering, setRegistering] = useState(Boolean(invitation));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    const status = await workspaceRequest<{ authenticated: boolean; user: Account | null }>("auth/status");
    setAccount(status.authenticated ? status.user : null);
  }
  useEffect(() => { refresh().catch(() => setError("Backend non raggiungibile. Controlla che NATHION sia avviato.")).finally(() => setLoading(false)); }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      if (registering) {
        await workspaceRequest("auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invitation, username, password, display_name: name }) });
        setNotice("Account creato. Attendi l'approvazione dell'amministratore, poi accedi."); setRegistering(false);
      } else {
        await workspaceRequest("auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
        await refresh();
      }
      setPassword("");
    } catch (e) { setError(e instanceof Error ? e.message : "Accesso fallito"); }
    finally { setBusy(false); }
  }
  if (loading) return <p className="p-8">Connessione a NATHION…</p>;
  if (account && !account.must_change_password) return <AccountContext.Provider value={account}>{children}</AccountContext.Provider>;
  return <main className="flex min-h-screen items-center justify-center bg-nathion-bg p-6 text-nathion-text"><div className="w-full max-w-md space-y-5 rounded-2xl border border-nathion-border bg-nathion-panel p-8"><h1 className="text-2xl">NATHION</h1>{account ? <><p>Benvenuto {account.display_name}. Sostituisci la password iniziale prima di continuare.</p><PasswordForm onChanged={() => refresh().catch(() => window.location.reload())} /></> : <form onSubmit={submit} className="space-y-5"><p>{registering ? "Crea il tuo account con questo invito." : "Accedi al tuo spazio personale."}</p><label className="block">Nome utente<input className={input} value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} autoComplete="username" required maxLength={32} pattern={registering ? "[a-z0-9][a-z0-9_.-]{2,31}" : undefined} /></label>{registering && <label className="block">Il tuo nome<input className={input} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={80} /></label>}<label className="block">Password<input className={input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={registering ? "new-password" : "current-password"} minLength={registering ? 12 : undefined} maxLength={200} required /></label><button className={button} disabled={busy}>{busy ? "Attendi…" : registering ? "Richiedi account" : "Accedi"}</button>{invitation && <button type="button" className="ml-3 text-sm" onClick={() => setRegistering(!registering)}>{registering ? "Ho già un account" : "Usa invito"}</button>}{notice && <p role="status">{notice}</p>}{error && <p role="alert" className="text-red-300">{error}</p>}</form>}</div></main>;
}

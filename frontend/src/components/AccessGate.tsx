import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { workspaceRequest } from "../api/client";

export interface Account { id: string; username: string; display_name: string; role: string; hosted_access: boolean; allowed_models: string[]; daily_limit: number; must_change_password: boolean; personal_mode?: boolean; }
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
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [guestLogin, setGuestLogin] = useState(false);
  const [personalMode, setPersonalMode] = useState(true);
  const [providers, setProviders] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [invitation, setInvitation] = useState(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get("invite") ?? "";
    if (value) window.history.replaceState(null, "", window.location.pathname + window.location.search);
    return value;
  });
  const [registering, setRegistering] = useState(Boolean(invitation));
  const [error, setError] = useState(() => {
    if (window.location.hash !== "#accesso-esterno-fallito") return "";
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    return "Accesso esterno non riuscito.";
  });
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    const status = await workspaceRequest<{ authenticated: boolean; user: Account | null; personal_mode: boolean; oauth_providers: string[] }>("auth/status");
    setAccount(status.authenticated && status.user ? { ...status.user, personal_mode: status.personal_mode } : null);
    setPersonalMode(status.personal_mode);
    setProviders(status.oauth_providers);
    if (status.personal_mode) setRegistering(false);
  }
  useEffect(() => { refresh().catch(() => setError("Backend non raggiungibile. Controlla che NATHION sia avviato.")).finally(() => setLoading(false)); }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      if (registering) {
        await workspaceRequest("auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invitation, username, password, display_name: name }) });
        setNotice("Account creato. Attendi l'approvazione dell'amministratore, poi accedi."); setRegistering(false);
      } else {
        await workspaceRequest("auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(guestLogin ? { username, password } : { email: email.trim(), password }) });
        await refresh();
      }
      setPassword("");
    } catch (e) { setError(e instanceof Error ? e.message : "Accesso fallito"); }
    finally { setBusy(false); }
  }
  if (loading) return <p className="p-8">Connessione a NATHION…</p>;
  if (account && !account.must_change_password) return <AccountContext.Provider value={account}>{children}</AccountContext.Provider>;
  return (
    <main className="flex min-h-screen items-center justify-center bg-nathion-bg p-6 text-nathion-text">
      <section className="w-full max-w-md space-y-6 rounded-3xl border border-nathion-border bg-nathion-panel p-8 shadow-xl">
        <header className="space-y-2">
          <p className="text-xs font-semibold tracking-widest text-nathion-muted">NATHION</p>
          <h1 className="text-3xl font-semibold">{registering ? "Crea il tuo account" : "Accedi al tuo spazio"}</h1>
        </header>
        {account ? (
          <>
            <p>Benvenuto {account.display_name}. Sostituisci la password iniziale prima di continuare.</p>
            <PasswordForm onChanged={() => refresh().catch(() => window.location.reload())} />
          </>
        ) : (
          <>
            <form onSubmit={submit} className="space-y-4">
              {registering || guestLogin ? (
                <label className="block">Nome utente
                  <input className={input} value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())}
                    autoComplete="username" required minLength={3} maxLength={32} pattern="[a-z0-9][a-z0-9_.\-]{2,31}" />
                </label>
              ) : (
                <label className="block">Email
                  <input className={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    autoComplete="username" required maxLength={254} placeholder="nome@esempio.it" />
                </label>
              )}
              {registering && (
                <>
                  <label className="block">Codice invito<input className={input} value={invitation} onChange={(e) => setInvitation(e.target.value.trim())} required maxLength={200} /></label>
                  <label className="block">Il tuo nome<input className={input} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={80} /></label>
                </>
              )}
              <label className="block">Password
                <input className={input} type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  autoComplete={registering ? "new-password" : "current-password"} minLength={12} maxLength={200} required />
              </label>
              <button className={`${button} w-full bg-nathion-text font-semibold text-nathion-bg`} disabled={busy}>
                {busy ? "Attendi…" : registering ? "Richiedi account" : "Accedi"}
              </button>
            </form>
            {!registering && !guestLogin && (
              <div className="grid grid-cols-2 gap-2 border-t border-nathion-border pt-4">
                {(["Google", "GitHub"] as const).map((label) => {
                  const provider = label.toLowerCase();
                  return providers.includes(provider)
                    ? <a key={label} className={`${button} text-center`} href={`/api/auth/oauth/${provider}/start`}>{label}</a>
                    : <button key={label} className={button} disabled>{label}<small className="block">Da configurare</small></button>;
                })}
              </div>
            )}
            {!personalMode && (
              <div className="flex flex-wrap gap-3 text-sm">
                <button type="button" onClick={() => { setError(""); setRegistering(!registering); }}>
                  {registering ? "Ho già un account" : "Registrati con invito"}
                </button>
                {!registering && <button type="button" onClick={() => { setError(""); setGuestLogin(!guestLogin); }}>
                  {guestLogin ? "Accedi con email" : "Accesso ospite"}
                </button>}
              </div>
            )}
            {notice && <p role="status">{notice}</p>}
            {error && <p role="alert" className="text-red-300">{error}</p>}
          </>
        )}
      </section>
    </main>
  );
}

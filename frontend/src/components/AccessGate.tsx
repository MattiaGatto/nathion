import { useEffect, useState, type ReactNode } from "react";
import { workspaceRequest } from "../api/client";

export function AccessGate({ children }: { children: ReactNode }) {
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    workspaceRequest<{ authenticated: boolean }>("auth/status")
      .then((status) => setAllowed(status.authenticated))
      .catch(() => setError("Backend non raggiungibile. Controlla che NATHION sia avviato."))
      .finally(() => setLoading(false));
  }, []);
  async function login(event: React.FormEvent) {
    event.preventDefault(); setError("");
    try {
      await workspaceRequest("auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      setToken(""); setAllowed(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Accesso fallito"); }
  }
  if (loading) return <p className="p-8">Connessione a NATHION…</p>;
  if (allowed) return <>{children}</>;
  return <main className="flex min-h-screen items-center justify-center bg-nathion-bg p-6 text-nathion-text"><form onSubmit={login} className="w-full max-w-md space-y-5 rounded-2xl border border-nathion-border bg-nathion-panel p-8"><h1 className="text-2xl">NATHION</h1><p>Inserisci la chiave personale configurata sul tuo PC.</p><label className="block">Chiave di accesso<input className="mt-2 w-full rounded-lg bg-nathion-bg p-3" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="current-password" required /></label><button className="rounded-lg bg-nathion-accent px-4 py-2 text-nathion-bg">Accedi</button>{error && <p role="alert" className="text-red-300">{error}</p>}</form></main>;
}

import { useEffect, useState, type FormEvent } from "react";
import { workspaceRequest } from "../api/client";
import { PasswordForm, useAccount } from "./AccessGate";

interface Profile {
  first_name: string;
  last_name: string;
  address: string;
}

const fields = [
  { key: "first_name", label: "Nome", autocomplete: "given-name", limit: 80 },
  { key: "last_name", label: "Cognome", autocomplete: "family-name", limit: 80 },
  { key: "address", label: "Indirizzo", autocomplete: "street-address", limit: 300 },
] as const;

export function ProfilePanel({ onClose }: { onClose: () => void }) {
  const account = useAccount();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    workspaceRequest<Profile>("auth/profile").then(setProfile).catch((e) => setError(e.message));
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await workspaceRequest<Profile>("auth/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      setProfile(saved);
      setNotice("Profilo salvato.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Salvataggio fallito.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await workspaceRequest("auth/logout", { method: "POST" });
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Uscita fallita.");
      setBusy(false);
    }
  }

  return <section aria-label="Profilo" className="absolute inset-0 z-30 overflow-auto bg-nathion-bg p-5">
    <div className="mx-auto max-w-lg space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div><h2 className="text-2xl">Il mio profilo</h2><p className="text-nathion-muted">@{account?.username} · {account?.role === "admin" ? "Amministratore" : "Ospite"}</p></div>
        <button onClick={onClose}>Chiudi</button>
      </header>
      {profile && <form className="space-y-4 rounded-2xl border border-nathion-border bg-nathion-panel p-5" onSubmit={save}>
        {fields.map(({ key, label, autocomplete, limit }) => <label key={key} className="block">
          {label}
          <input value={profile[key]} autoComplete={autocomplete} maxLength={limit}
            onChange={(event) => setProfile({ ...profile, [key]: event.target.value })}
            className="mt-1 w-full rounded-lg bg-nathion-bg p-3" />
        </label>)}
        <button disabled={busy} className="rounded-lg bg-nathion-accent px-4 py-2 text-black">Salva profilo</button>
      </form>}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert" className="text-red-300">{error}</p>}
      <PasswordForm onChanged={() => window.location.reload()} />
      <button disabled={busy} onClick={logout} className="rounded-lg border border-red-400 px-4 py-2 text-red-300">Esci dall’account</button>
    </div>
  </section>;
}

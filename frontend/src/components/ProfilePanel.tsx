import Markdown from "react-markdown";
import { useEffect, useState, type FormEvent } from "react";
import { workspaceRequest } from "../api/client";
import { PasswordForm, useAccount } from "./AccessGate";

export interface Profile {
  first_name: string;
  last_name: string;
  address: string;
  avatar: string;
  bio: string;
}

const fields = [
  { key: "first_name", label: "Nome", autocomplete: "given-name", limit: 80 },
  { key: "last_name", label: "Cognome", autocomplete: "family-name", limit: 80 },
  { key: "address", label: "Indirizzo", autocomplete: "street-address", limit: 300 },
] as const;

export function ProfilePanel({ onClose, onSaved }: { onClose: () => void; onSaved: (profile: Profile) => void }) {
  const account = useAccount();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingBio, setEditingBio] = useState(false);

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
      onSaved(saved);
      setEditingBio(false);
      setNotice("Profilo salvato.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Salvataggio fallito.");
    } finally {
      setBusy(false);
    }
  }

  async function chooseAvatar(file: File) {
    setError("");
    if (file.size > 8 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Scegli una foto JPEG, PNG o WebP fino a 8 MB.");
      return;
    }
    try {
      const image = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 160;
      const context = canvas.getContext("2d");
      if (!context) { image.close(); throw new Error("Immagine non disponibile"); }
      const side = Math.min(image.width, image.height);
      context.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, 160, 160);
      image.close();
      const avatar = canvas.toDataURL("image/jpeg", 0.82);
      setProfile((current) => current && { ...current, avatar });
    } catch {
      setError("Impossibile leggere questa foto.");
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

  return <section aria-label="Profilo" className="absolute inset-0 z-40 overflow-auto bg-nathion-bg p-4 sm:p-6">
    <div className="mx-auto max-w-lg space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div><h2 className="text-2xl">Il mio profilo</h2><p className="text-nathion-muted">@{account?.username} · {account?.role === "admin" ? "Amministratore" : "Ospite"}</p></div>
        <button onClick={onClose}>Chiudi</button>
      </header>
      {profile && <form className="space-y-4 rounded-2xl border border-nathion-border bg-nathion-panel p-5" onSubmit={save}>
        <div className="flex flex-wrap items-center gap-4">
          {profile.avatar
            ? <img className="h-16 w-16 rounded-full object-cover" src={profile.avatar} alt="Foto profilo" />
            : <span aria-hidden="true" className="grid h-16 w-16 place-items-center rounded-full bg-nathion-accent/20 text-xl text-nathion-accent">{(profile.first_name || account?.username || "N").slice(0, 1).toUpperCase()}</span>}
          <div className="space-y-2">
            <label className="block text-sm">Foto profilo
              <input className="block max-w-full text-xs" type="file" accept="image/jpeg,image/png,image/webp"
                onChange={(event) => { const file = event.target.files?.[0]; if (file) void chooseAvatar(file); }} />
            </label>
            {profile.avatar && <button type="button" className="text-xs text-nathion-muted" onClick={() => setProfile({ ...profile, avatar: "" })}>Rimuovi foto</button>}
          </div>
        </div>
        {fields.map(({ key, label, autocomplete, limit }) => <label key={key} className="block">
          {label}
          <input value={profile[key]} autoComplete={autocomplete} maxLength={limit}
            onChange={(event) => setProfile({ ...profile, [key]: event.target.value })}
            className="mt-1 w-full rounded-lg bg-nathion-bg p-3" />
        </label>)}
        <section className="rounded-xl border border-sky-400/20 bg-sky-950/20 p-4" aria-label="Bio personale">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-sky-200">Bio personale</h3>
            <button type="button" className="rounded-lg border border-nathion-border px-3 py-2 text-sm" onClick={() => setEditingBio(!editingBio)}>
              {editingBio ? "Anteprima" : "Modifica bio"}
            </button>
          </div>
          <p className="mt-1 text-xs text-nathion-muted">Il modello usa questa bio come contesto. Puoi descrivere progetti, preferenze e interessi in Markdown.</p>
          {editingBio ? <textarea aria-label="Bio in Markdown" value={profile.bio} rows={7} maxLength={2400}
            placeholder={"## Chi sono\n\n- Progetti\n- Preferenze"} onChange={(event) => setProfile({ ...profile, bio: event.target.value })}
            className="mt-3 w-full rounded-lg bg-nathion-bg p-3 font-mono text-sm" />
            : <div className="profile-markdown mt-3 text-sm"><Markdown skipHtml disallowedElements={["img"]}>{profile.bio || "*La tua bio è vuota.*"}</Markdown></div>}
        </section>
        <button disabled={busy} className="rounded-lg bg-nathion-accent px-4 py-2 text-black">Salva profilo</button>
      </form>}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert" className="text-red-300">{error}</p>}
      <PasswordForm onChanged={() => window.location.reload()} />
      <button disabled={busy} onClick={logout} className="rounded-lg border border-red-400 px-4 py-2 text-red-300">Esci dall’account</button>
    </div>
  </section>;
}

import { stopAllAudio } from "./audioOwner";
import { useCallback, useEffect, useState } from "react";
import { api, workspaceRequest, type ConversationSummary } from "./api/client";
import { ChatWindow } from "./components/ChatWindow";
import { ProfilePanel, type Profile } from "./components/ProfilePanel";
import { Sidebar } from "./components/Sidebar";
import { SettingsPanel } from "./components/SettingsPanel";
import { WorkspacePanel } from "./components/WorkspacePanel";
import { AccessGate, useAccount } from "./components/AccessGate";

export default function App() {
  return <AccessGate><Application /></AccessGate>;
}

function Application() {
  const account = useAccount();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.innerWidth < 768);
  const [bootError, setBootError] = useState<string | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    workspaceRequest<Profile>("auth/profile").then(setProfile).catch(() => {});
  }, []);

  const profileName = profile?.first_name || account?.display_name || "Profilo";

  const refreshConversations = useCallback(async () => {
    const list = await api.listConversations();
    setConversations(list);
    return list;
  }, []);

  // All'avvio: carica lo storico, la preferenza di modello salvata e
  // apre l'ultima conversazione attiva (o ne crea una se non ce n'e'
  // ancora nessuna).
  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const [list, settings] = await Promise.all([refreshConversations(), api.getSettings()]);
        if (cancelled) return;

        if (settings.default_model) {
          setModel(settings.default_model);
        } else {
          // Nessuna preferenza salvata ancora: seleziona in silenzio il
          // primo modello Ollama disponibile, cosi' l'app e' subito
          // utilizzabile senza dover passare dalle impostazioni. Se
          // Ollama non e' raggiungibile, semplicemente non si imposta
          // nulla e la UI lo segnala (vedi la barra di scrittura).
          try {
            const models = await api.listModels();
            const preferred = models.find((item) => item.id === "llama3.2:3b") ?? models[0];
            if (!cancelled && preferred) {
              setModel(preferred.id);
              await api.updateSettings({ default_provider: settings.default_provider, default_model: preferred.id });
            }
          } catch {
            // Silenzioso: l'utente vedra' comunque lo stato "nessun
            // modello" nell'header e potra' aprire le impostazioni per
            // il messaggio di errore dettagliato.
          }
        }

        const candidate = list.find((conversation) => conversation.title === "Nuova conversazione");
        const draft = candidate ? await api.getConversation(candidate.id) : null;
        if (cancelled) return;
        if (draft && draft.messages.length === 0) {
          setActiveId(draft.id);
        } else {
          const created = await api.createConversation();
          if (cancelled) return;
          setActiveId(created.id);
          await refreshConversations();
        }
      } catch (err) {
        if (!cancelled) setBootError(err instanceof Error ? err.message : "Errore di avvio");
      } finally {
        if (!cancelled) setConversationsLoading(false);
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [refreshConversations]);

  async function handleNewConversation() {
    const created = await api.createConversation();
    setActiveId(created.id);
    await refreshConversations();
  }

  async function handleDeleteConversation(id: string) {
    await api.deleteConversation(id);
    const remaining = conversations.filter((c) => c.id !== id);
    setConversations(remaining);

    if (id === activeId) {
      if (remaining.length > 0) {
        setActiveId(remaining[0].id);
      } else {
        const created = await api.createConversation();
        setActiveId(created.id);
        await refreshConversations();
      }
    }
  }

  if (bootError) {
    return (
      <div className="flex h-screen items-center justify-center bg-nathion-bg px-6 text-center">
        <div className="max-w-sm">
          <p className="text-sm text-red-400">Impossibile avviare NATHION: {bootError}</p>
          <p className="mt-2 text-xs text-nathion-muted">
            Verifica che il backend sia raggiungibile (vedi README, sezione Avvio rapido).
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-nathion-bg bg-grid-fade">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        loading={conversationsLoading}
        onSelect={(id) => { setActiveId(id); if (window.innerWidth < 768) setSidebarCollapsed(true); }}
        onNew={() => { void handleNewConversation(); if (window.innerWidth < 768) setSidebarCollapsed(true); }}
        onDelete={handleDeleteConversation}
        onOpenSettings={() => { stopAllAudio(); if (window.innerWidth < 768) setSidebarCollapsed(true); setSettingsOpen(true); }}
        onOpenAgents={() => { stopAllAudio(); if (window.innerWidth < 768) setSidebarCollapsed(true); setWorkspaceOpen(true); }}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
      />

      <main className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-nathion-border/70 px-3 sm:px-7">
          <div className="flex min-w-0 items-center gap-2">
            <button type="button" className="grid h-10 w-9 shrink-0 place-items-center rounded-lg text-sky-200 md:hidden"
              aria-label="Apri cronologia chat" aria-expanded={!sidebarCollapsed} onClick={() => setSidebarCollapsed((value) => !value)}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                <path d="M4 6h16M4 12h16M4 18h11" />
              </svg>
            </button>
            <div className="min-w-0">
              <span className="block truncate text-sm font-semibold tracking-wide">NATHION</span>
              <span className="hidden text-xs text-nathion-muted sm:block">Assistente vocale</span>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-5">
            <button className="rounded-lg px-2 py-2 text-xs text-nathion-muted hover:text-nathion-text" onClick={() => { stopAllAudio(); setSettingsOpen(true); }}>Impostazioni</button>
            <button className="text-xs text-nathion-muted hover:text-nathion-text" onClick={() => { stopAllAudio(); setWorkspaceOpen(true); }}>Agenti</button>
            <button aria-label="Apri profilo" title="Apri profilo" className="flex items-center gap-2 rounded-full border border-nathion-border bg-nathion-panel px-2 py-1 text-sm hover:border-nathion-accent" onClick={() => { stopAllAudio(); setProfileOpen(true); }}>
              {profile?.avatar
                ? <img src={profile.avatar} alt="" className="h-8 w-8 rounded-full object-cover" />
                : <span className="grid h-8 w-8 place-items-center rounded-full bg-nathion-accent/20 font-semibold text-nathion-accent">{profileName.slice(0, 1).toUpperCase()}</span>}
              <span className="hidden pr-2 sm:inline">{profileName}</span>
            </button>
          </div>
        </header>
        {profileOpen && <ProfilePanel onClose={() => setProfileOpen(false)} onSaved={setProfile} />}
        {workspaceOpen && <WorkspacePanel model={model} onClose={() => setWorkspaceOpen(false)} />}
        {account?.role !== "admin" && !account?.hosted_access && <p role="status" className="px-4 py-2 text-sm text-amber-300">Il tuo spazio è attivo. L’uso dei modelli di questo PC attende l’approvazione dell’amministratore.</p>}
        {activeId && (
          <ChatWindow
            key={activeId}
            conversationId={activeId}
            model={model}
            onConversationUpdated={refreshConversations}
            onOpenSettings={() => { stopAllAudio(); setSettingsOpen(true); }}
          />
        )}
      </main>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        currentModel={model}
        onModelSaved={setModel}
        onOpenProfile={() => { setSettingsOpen(false); setProfileOpen(true); }}
      />
    </div>
  );
}

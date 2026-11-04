import { useCallback, useEffect, useState } from "react";
import { api, type ConversationSummary } from "./api/client";
import { ChatWindow } from "./components/ChatWindow";
import { Sidebar } from "./components/Sidebar";
import { SettingsPanel } from "./components/SettingsPanel";
import { WorkspacePanel } from "./components/WorkspacePanel";
import { AccessGate } from "./components/AccessGate";
import { workspaceRequest } from "./api/client";

export default function App() {
  return <AccessGate><Application /></AccessGate>;
}

function Application() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.innerWidth < 768);
  const [bootError, setBootError] = useState<string | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);

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
          // nulla e la UI lo segnala (vedi Composer/EmptyState).
          try {
            const models = await api.listModels();
            if (!cancelled && models[0]) {
              setModel(models[0].id);
              await api.updateSettings({ default_provider: "ollama", default_model: models[0].id });
            }
          } catch {
            // Silenzioso: l'utente vedra' comunque lo stato "nessun
            // modello" nell'header e potra' aprire le impostazioni per
            // il messaggio di errore dettagliato.
          }
        }

        if (list.length > 0) {
          setActiveId(list[0].id);
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
    <div className="flex h-screen overflow-hidden bg-nathion-bg bg-grid-fade">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        loading={conversationsLoading}
        onSelect={setActiveId}
        onNew={handleNewConversation}
        onDelete={handleDeleteConversation}
        onOpenSettings={() => setSettingsOpen(true)}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
      />

      <main className="relative min-w-0 flex-1 pt-10">
        <button className="absolute right-4 top-2 text-xs text-nathion-accent" onClick={() => setWorkspaceOpen(true)}>Centro di controllo</button>
        <button className="absolute left-4 top-2 text-xs text-nathion-muted" onClick={() => workspaceRequest("auth/logout", { method: "POST" }).then(() => window.location.reload())}>Esci</button>
        {workspaceOpen && <WorkspacePanel model={model} onClose={() => setWorkspaceOpen(false)} />}
        {activeId && (
          <ChatWindow
            key={activeId}
            conversationId={activeId}
            model={model}
            onConversationUpdated={refreshConversations}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        )}
      </main>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        currentModel={model}
        onModelSaved={setModel}
      />
    </div>
  );
}

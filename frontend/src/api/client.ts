// Client HTTP minimale verso il backend NATHION.
//
// In sviluppo (`npm run dev`) i path relativi passano dal proxy di Vite
// verso localhost:8000. Nella build Docker di produzione non c'è un
// reverse proxy davanti ai due container in questa milestone, quindi
// VITE_API_BASE_URL (impostata in docker-compose.yml) punta il browser
// direttamente alla porta del backend esposta sull'host.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";
const fetch = (input: RequestInfo | URL, init?: RequestInit) =>
  window.fetch(input, { ...init, credentials: "include" });

export interface ModelInfo {
  id: string;
  label: string;
  size_bytes: number | null;
}

export interface SettingsPayload {
  default_provider: string;
  default_model: string | null;
}

export interface ConversationSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface MessageOut {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  model_used: string | null;
  created_at: string;
}

export interface ConversationDetail extends ConversationSummary {
  messages: MessageOut[];
}

async function handle<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail ?? `Richiesta fallita (${response.status})`);
  }
  // Una 204 No Content (es. DELETE) non ha corpo: chiamare .json() su una
  // risposta vuota solleva "Unexpected end of JSON input".
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export async function workspaceRequest<T>(path: string, options?: RequestInit): Promise<T> {
  return handle<T>(await fetch(`${API_BASE_URL}/api/${path}`, options));
}

export const api = {
  voiceStatus: () => fetch(`${API_BASE_URL}/api/voice/status`).then((r) =>
    handle<{ enabled: boolean; whisper_model_present: boolean; piper_model_present: boolean }>(r)),
  transcribe: (audio: Blob, signal?: AbortSignal) =>
    fetch(`${API_BASE_URL}/api/voice/transcribe`, {
      method: "POST", headers: { "Content-Type": audio.type }, body: audio, signal,
    }).then((r) => handle<{ text: string }>(r)),
  speak: async (text: string, signal?: AbortSignal) => {
    const response = await fetch(`${API_BASE_URL}/api/voice/speak`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }), signal,
    });
    if (!response.ok) { await handle<never>(response); }
    return response.blob();
  },
  health: () => fetch(`${API_BASE_URL}/health`).then((r) => handle<{ status: string }>(r)),

  listModels: (provider?: string) => fetch(`${API_BASE_URL}/api/models${provider ? `?provider=${encodeURIComponent(provider)}` : ""}`).then((r) => handle<ModelInfo[]>(r)),
  listProviders: () => workspaceRequest<string[]>("providers"),

  getSettings: () =>
    fetch(`${API_BASE_URL}/api/settings`).then((r) => handle<SettingsPayload>(r)),

  updateSettings: (payload: SettingsPayload) =>
    fetch(`${API_BASE_URL}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then((r) => handle<SettingsPayload>(r)),

  createConversation: (title?: string) =>
    fetch(`${API_BASE_URL}/api/chat/conversations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }).then((r) => handle<ConversationSummary>(r)),

  listConversations: () =>
    fetch(`${API_BASE_URL}/api/chat/conversations`).then((r) => handle<ConversationSummary[]>(r)),

  getConversation: (id: string) =>
    fetch(`${API_BASE_URL}/api/chat/conversations/${id}`).then((r) => handle<ConversationDetail>(r)),

  deleteConversation: (id: string) =>
    fetch(`${API_BASE_URL}/api/chat/conversations/${id}`, { method: "DELETE" }).then((r) =>
      handle<void>(r)
    ),
};

export function chatWebSocketUrl(conversationId: string, model: string): string {
  const base = API_BASE_URL || window.location.origin;
  const protocol = base.startsWith("https") ? "wss" : "ws";
  const host = base.replace(/^https?:\/\//, "");
  const params = new URLSearchParams({ model });
  return `${protocol}://${host}/api/chat/ws/chat/${conversationId}?${params}`;
}

export function voiceWebSocketUrl(): string {
  const base = API_BASE_URL || window.location.origin;
  return `${base.replace(/^http/, "ws")}/api/voice/ws`;
}

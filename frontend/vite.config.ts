import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proxy verso il backend in sviluppo: evita problemi CORS e permette di
// scrivere il client API con path relativi ("/api/...").
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // ws: true serve perché /api/chat/ws/... è un endpoint WebSocket:
      // senza, il proxy non fa l'upgrade della connessione.
      "/api": { target: "http://localhost:8000", ws: true },
      "/health": "http://localhost:8000",
    },
  },
});

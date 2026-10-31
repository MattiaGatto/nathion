# NATHION

> Your Intelligence. Your System. Your Control.

Assistente AI personale, locale, multimodale e multi-agent. Questo
repository è alla **Milestone 1 — Foundation**: chat testuale
funzionante tra un frontend React e un backend FastAPI, con un LLM
Gateway che parla con Ollama in locale, e persistenza delle
conversazioni su SQLite.

Vedi `docs/adr/` per le decisioni architetturali e il documento di
costituzione del progetto per la roadmap completa.

## Prerequisiti

- Docker Desktop (con backend WSL2 se sei su Windows)
- [Ollama](https://ollama.com) installato e in esecuzione sull'host,
  con almeno un modello scaricato:
  ```bash
  ollama pull llama3.1
  ```

## Avvio rapido

```bash
cp .env.example .env
docker compose up --build
```

- Backend: http://localhost:8000 (healthcheck su `/health`)
- Frontend: http://localhost:4173

Apri il frontend: all'avvio crea automaticamente una conversazione,
interroga Ollama per i modelli disponibili e li mostra nel menu in
alto a destra. Se il menu dice "Nessun modello trovato", esegui
`ollama pull <nome-modello>` e ricarica la pagina.

## Sviluppo con hot-reload

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

In questa modalità il frontend gira su http://localhost:5173 con Vite
in dev mode (hot reload) e il backend con `uvicorn --reload`.

In alternativa, per sviluppare senza Docker:

```bash
# backend
cd backend
pip install -e ".[dev]"
uvicorn app.main:app --reload

# frontend (altro terminale)
cd frontend
npm install
npm run dev
```

## Note per Windows + WSL2

Con Docker Desktop configurato per usare il backend WSL2,
`host.docker.internal` (il default in `.env.example`) risolve
automaticamente all'host Windows dove gira Ollama — non serve
configurazione aggiuntiva. Se Ollama è in esecuzione **dentro** WSL2
invece che su Windows nativo, verifica con `curl http://localhost:11434`
dentro WSL2 che risponda, poi lascia comunque `host.docker.internal`:
Docker Desktop instrada correttamente in entrambi i casi.

## Note per Linux nativo (senza Docker Desktop)

`host.docker.internal` non è risolto automaticamente da Docker Engine
puro. Il `docker-compose.yml` include già
`extra_hosts: host.docker.internal:host-gateway`, che dovrebbe bastare
su kernel Linux recenti. Se non funziona, alternative:

- Imposta `NATHION_OLLAMA_BASE_URL` all'IP del bridge Docker (di solito
  `http://172.17.0.1:11434`, verifica con `ip addr show docker0`).
- Oppure aggiungi `network_mode: host` al servizio `backend` nel
  compose file e usa `http://localhost:11434`.

## Test

```bash
cd backend
pip install -e ".[dev]"
pytest
```

8 test coprono: healthcheck, creazione/recupero conversazioni (criterio
di accettazione "persistenza"), routing del gateway verso un provider
(con un provider finto, per non dipendere da un'istanza Ollama in
esecuzione durante i test).

## Struttura del repo

```
backend/app/
  main.py          # entrypoint FastAPI
  api/             # endpoint REST + WebSocket
  core/            # config e logging
  llm/             # LLM Gateway + provider (Ollama)
  db/              # modelli SQLAlchemy + sessione
  schemas/         # Pydantic request/response
frontend/src/
  components/      # ChatWindow, MessageBubble, ModelSelector, StatusIndicator
  hooks/           # useChatSocket (WebSocket streaming)
  api/             # client HTTP
docs/adr/          # Architecture Decision Records
```

## Criteri di accettazione Milestone 1

- [x] `docker compose up` avvia frontend+backend senza errori
- [x] `GET /health` risponde 200
- [x] Il gateway instrada correttamente verso un provider (verificato
      con provider finto nei test; verificato manualmente con Ollama
      reale: vedi sopra)
- [x] Una conversazione e i suoi messaggi sopravvivono a un riavvio
      (SQLite persistito su volume Docker)
- [x] Messaggio inviato via API → risposta salvata in DB
- [x] Chat testuale funzionante da browser
- [x] `pytest` verde (8/8)
- [x] ADR-001 documentato

## Prossimo passo

Milestone 2 — Voice Engine (microfono, VAD, STT/TTS, streaming audio).

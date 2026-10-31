# ADR-001 — Scelte tecnologiche Milestone 1 (Foundation)

**Stato:** Accettata
**Data:** 2026-10-31

## Contesto

La Milestone 1 richiede una base funzionante: repo, Docker Compose,
backend FastAPI, frontend React, LLM Gateway, integrazione Ollama, chat
testuale, persistenza conversazioni (costituzione NATHION §13).

## Decisioni

1. **SQLite come store di persistenza iniziale**, non Postgres.
   Motivazione: uso locale single-user, zero infrastruttura aggiuntiva
   da gestire in Docker Compose. Verrà rivalutato se/quando servirà
   accesso concorrente multi-processo o ricerca vettoriale (Milestone
   5, dove è già previsto Qdrant).

2. **LLM Gateway con interfaccia astratta `LLMProvider`** implementata
   fin da subito, anche se l'unico provider concreto è Ollama.
   Motivazione: è il requisito "provider-agnostic" della costituzione
   (§3.2); costruirlo bene ora evita una rifattorizzazione quando si
   aggiungerà LM Studio/OpenAI.

3. **Selezione del modello dinamica da `/api/models`**, che interroga
   `GET /api/tags` di Ollama in tempo reale, invece di una lista
   statica nel codice. Motivazione: richiesta esplicita dell'utente —
   la UI deve mostrare solo i modelli realmente scaricati sulla
   macchina, evitando disallineamenti.

4. **WebSocket per la chat** (oltre a un endpoint REST non-streaming
   usato nei test): prepara la Milestone 2 (voce, risposte
   progressive) senza introdurre ancora STT/TTS.

5. **Niente Alembic in questa milestone**: lo schema è creato con
   `Base.metadata.create_all`. Verrà introdotto un vero sistema di
   migrazioni quando lo schema cambierà in modo incompatibile tra
   ambienti (regola §15: non introdurre complessità prima che serva).

6. **Ollama non containerizzato**: gira sull'host per usare la GPU
   (§10). Il backend lo raggiunge via `host.docker.internal`, che
   funziona nativamente con Docker Desktop (Windows/WSL2, macOS). Per
   Linux senza Docker Desktop è documentata un'alternativa nel README.

## Conseguenze

- Migrare da SQLite a Postgres in futuro richiederà solo cambiare
  `NATHION_DATABASE_URL` e aggiungere Alembic — lo schema SQLAlchemy
  non cambia.
- Aggiungere un nuovo provider LLM richiede una nuova classe in
  `app/llm/` più una riga in `LLMGateway._providers` — nessun altro
  file da toccare.

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

## Addendum — revisione del 2026-11-01

Prima del collaudo sulla macchina dell'utente, è stata fatta una
revisione completa del codice (bug fix) e un redesign dell'interfaccia:

**Bug corretti:**
- `conversation.updated_at` non veniva mai aggiornato all'arrivo di un
  messaggio (solo `onupdate` su modifica diretta della riga), quindi lo
  storico ordinato per "ultima attività" era di fatto statico.
  Aggiunto `Conversation.touch()`, chiamato a ogni messaggio.
- Il titolo della conversazione restava sempre "Nuova conversazione":
  aggiunta `_derive_title()` che lo imposta dal primo messaggio utente.
- Il WebSocket apriva la sessione DB con `next(get_db())`, lasciando il
  generatore sospeso (il suo `finally` sarebbe scattato solo al
  garbage collection). Sostituito con `SessionLocal()` esplicito.
- Nel client frontend, `handle<T>()` chiamava sempre `response.json()`,
  che fallisce su una risposta 204 No Content — rilevante per il nuovo
  endpoint di cancellazione conversazione.

**Aggiunte:**
- `DELETE /api/chat/conversations/{id}` (con conferma a due passaggi
  nella UI).
- Frontend ricostruito attorno a: sidebar con storico conversazioni
  (cronologia, nuova conversazione, eliminazione), pannello
  Impostazioni (selezione modello Ollama disponibile, persistita via
  `/api/settings`), composer con textarea auto-espandibile e invio con
  Invio/Shift+Invio, indicatore di digitazione durante lo streaming,
  stato vuoto con suggerimenti. Palette scura "futuristica" coerente
  con la tagline di progetto, animazioni leggere, tipografia
  Space Grotesk/Inter.
- Suite di test ampliata (12 test): copre titolo automatico,
  ordinamento storico, invio messaggio end-to-end, cancellazione,
  tramite un provider LLM finto (`StubProvider`) iniettato via
  dependency override di FastAPI — nessuna dipendenza da un'istanza
  Ollama reale durante i test.

Vedi anche ADR-002 per i requisiti raccolti su agenti configurabili
multi-utente e compatibilità mobile/Android Auto, pianificati per le
milestone successive.

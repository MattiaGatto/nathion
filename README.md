# NATHION

**Your Intelligence. Your System. Your Control.**

Assistente personale locale con chat, voce, agenti specializzati, memoria
controllabile e strumenti soggetti a permessi. Il telefono è un client:
modelli e dati rimangono sul PC, salvo provider esterni configurati esplicitamente.

## Avvio su questo PC

Prerequisiti: Docker Desktop, Ollama in esecuzione e almeno un modello chat.
I modelli Whisper, Piper e mxbai embedding sono già stati preparati su questo PC.

```powershell
./start.ps1
```

Imposta `NATHION_ADMIN_EMAIL` nel file `.env` prima dell’avvio.
Apri [NATHION](http://localhost:4173) e accedi con questa email. Su una nuova
installazione trovi la password iniziale nel file `backend/data/admin-initial-password.txt`, escluso da Git.
Al primo accesso scegli una nuova password (almeno 12 caratteri).
`backend/data/access-token.txt` è una chiave operatore per recupero e script:
non condividerla con gli invitati. Su una nuova installazione puoi cambiare
nome amministratore con le variabili `NATHION_ADMIN_USERNAME` e
`NATHION_ADMIN_DISPLAY_NAME` prima del primo avvio.

Senza lo script:

```powershell
docker compose -f docker-compose.yml -f docker-compose.voice.yml up -d --build --wait
docker compose cp backend:/app/data/access-token.txt ./backend/data/access-token.txt
```

Il backend rimane su localhost:8000; il frontend inoltra API e WebSocket
allo stesso indirizzo della pagina. Le porte sono pubblicate solo su loopback.
Non cancellare il volume backend_data se vuoi conservare chiave e cronologia.

## Cosa puoi usare

- Chat testuale persistente con streaming e interruzione della generazione.
- Voce manuale o conversazione con fine turno automatica, frasi progressive e stop.
- Sette agenti, skills e workflow con dipendenze; piani LLM da rivedere prima dell’avvio.
- Modello e voce configurabili per agente, ascolto sequenziale dei contributi.
- Memoria esplicita e suggerimenti selettivi da approvare, con fonte e certezza.
- Ricerca BM25 e semantica locale, con fallback dichiarato e stato di indicizzazione.
- Calcolatrice e orologio autorizzati; cancellazioni e chiamate MCP con approvazione.
- Attività locali programmate, una tantum o ricorrenti, con risultati persistiti.
- Account con password, Mattia amministratore, inviti e approvazione del server.
- Dati separati per utente, modelli consentiti, quote e sessioni revocabili.
- APK Android firmato e preconfigurato per il PC su Tailscale, oltre alla PWA.
- Profilo privato, accesso con password e registrazione su invito.
- Provider compatibile opzionale, senza connessioni cloud obbligatorie.

Il **Centro di controllo** contiene agenti, memoria, attività, voci, strumenti
e programmazioni. Le operazioni MCP richiedono server e tool esplicitamente
configurati dal proprietario. Non viene concesso accesso arbitrario alla shell.

## Guida e stato

- [Avvio, accesso, backup e configurazione](docs/OPERATIONS.md)
- [Voce locale e verifiche](docs/VOICE.md)
- [Account, ospiti e installazioni indipendenti](docs/ACCOUNTS.md)
- [Procedura Android](docs/ANDROID.md)
- [Capacità effettive e lavoro rimanente](docs/STATUS.md)
- [Decisioni architetturali](docs/adr/)

Il collaudo Android richiede account/rete privata, permesso microfono e prova
sul telefono. Le prove automatiche o con audio sintetico non sostituiscono
questo collaudo. Fine turno e interruzione parlando sono implementati con
controlli locali; la qualità acustica sul tuo telefono resta da verificare.

## Sviluppo

Python 3.12+ e Node.js 24 sono necessari soltanto per lo sviluppo senza Docker.
Dal backend installa gli extra necessari e avvia uvicorn su loopback:

```powershell
cd backend
uv sync --extra voice --extra mcp
uv run uvicorn app.main:app --host 127.0.0.1 --reload
```

Configura i percorsi dei modelli e Ollama per l'host come descritto nella guida.
In un altro terminale, dal frontend:

```powershell
npm ci
npm run dev
```

Le API usano un cookie HttpOnly o Bearer per gli script. I segreti si
configurano nell'ambiente, senza inserirli nel codice o nel repository.

## Uso desktop

Accedi al tuo account e apri una nuova conversazione. Premi il microfono al
centro per armare l'ascolto e pronuncia «Ehi Nathion». Puoi dire il comando e
la domanda nella stessa frase. NATHION trascrive la domanda, scrive la
risposta nella chat e la legge. Dalla barra a sinistra puoi riaprire le
conversazioni salvate. La foto in alto a destra apre profilo e disconnessione.

`npm run build` compila il frontend. `./scripts/backup.ps1` salva una copia
coerente del database anche mentre l'app è attiva.

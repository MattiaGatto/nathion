# Avvio e accesso

```powershell
docker compose -f docker-compose.yml -f docker-compose.voice.yml up -d --build
docker compose cp backend:/app/data/access-token.txt ./backend/data/access-token.txt
```

Accedi come `mattia` con la password iniziale copiata da `./start.ps1` in
`backend/data/admin-initial-password.txt`. Il primo accesso richiede di
sostituirla. Nelle installazioni nuove nome e nome visualizzato si configurano
con `NATHION_ADMIN_USERNAME` e `NATHION_ADMIN_DISPLAY_NAME`.

Le password sono salvate con Argon2id; le sessioni browser durano 8 ore e usano
cookie HttpOnly, SameSite Strict e Secure su HTTPS. Il database conserva solo
l'hash dei token. Logout revoca la sessione; cambio password e modifica dei
permessi revocano tutte le sessioni dell'account. Le connessioni chat gi� aperte
ricontrollano l'autorizzazione prima di una nuova richiesta e durante lo stream.
Un calcolo nativo gi� iniziato pu� terminare: la revoca non annulla effetti gi�
avvenuti. Le chiamate vocali ricontrollano autorizzazioni a ogni segmento.

La chiave operatore `backend/data/access-token.txt` resta per gli script locali
e per il recupero amministratore. Consente pieno accesso: non condividerla.
Gli invitati usano esclusivamente i propri account. Vedi [Account](ACCOUNTS.md).
L'autenticazione � attiva per default; i test la disattivano solo in fixture
isolate. Il backend verifica l'origine di scritture e WebSocket.

Il Centro di controllo contiene agenti, workflow e memoria. La chat ordinaria
resta il percorso diretto al modello; il pulsante Avvia attività usa realmente
l'orchestratore. Gli agenti analizzano e generano testo: non hanno ancora
permesso di eseguire codice o navigare in rete.

La sezione strumenti include calcolatrice locale e richieste di eliminazione
memoria: la cancellazione resta pendente finché premi Approva. Nei workflow,
"calcola 12 + 3" usa un tool autorizzato e registra il risultato nella timeline.
NATHION_OLLAMA_CONTEXT_SIZE (default 2048) e NATHION_OLLAMA_MAX_OUTPUT_TOKENS
(default 512) regolano risorse e lunghezza. Se il provider segnala un taglio
per limite token, il workflow fallisce esplicitamente invece di dichiarare
completo del codice troncato. Aumenta i limiti in .env solo in base alle risorse.

## Smartphone e PWA

Il frontend usa un proxy same-origin per HTTP e WebSocket, quindi non contiene
indirizzi localhost del backend nel bundle di produzione. Su schermi piccoli
la barra laterale parte compressa. Il service worker conserva esclusivamente
risorse dell'interfaccia; API, memorie e conversazioni non sono messe in cache.
L'AI richiede il PC acceso anche se l'interfaccia è disponibile offline.

Per il microfono e l'installazione su telefono serve HTTPS. Si può usare
Tailscale Serve puntato a localhost:4173, limitato alla propria rete privata;
prima va aggiunta l'origine HTTPS effettiva a NATHION_CORS_ALLOW_ORIGINS nel
file .env e ricreato il backend. Non usare il semplice IP HTTP del PC per
la conversazione vocale. Non è stata aperta alcuna porta a Internet né
configurato un account Tailscale per conto dell'utente. Installazione PWA,
permesso microfono e audio vanno provati sul dispositivo reale.

## Dati e ripristino

SQLite e chiave sono nel volume backend_data. Arresta i servizi prima di
copiare il database per un backup coerente. Conserva il volume quando
aggiorni le immagini: non usare down -v se vuoi mantenere i dati.
I modelli sono nella directory models sull'host, montata in sola lettura.
La cancellazione di una conversazione elimina anche i messaggi; quella di
una memoria è esplicita nel Centro di controllo.

## Verifica

Con dipendenze dev/voice installate nel backend:

```powershell
python -m pytest -q
python scripts/check_stack.py
python scripts/check_product.py
```

Gli script reali richiedono i container attivi e la copia locale della chiave.
Il secondo usa audio sintetico. Il terzo verifica accesso, proxy, assets PWA,
skills, memoria e due agenti con dipendenza su Ollama. I report sono in data.

## Provider e memoria semantica

Un server compatibile si abilita esplicitamente in .env con
NATHION_COMPATIBLE_BASE_URL, per esempio http://host.docker.internal:1234/v1
per un LM Studio locale nell'host. Se serve, aggiungi NATHION_COMPATIBLE_API_KEY.
Ricrea il backend; il provider appare nelle impostazioni. Non sono stati
configurati servizi cloud. Il contratto è testato, ma LM Studio/vLLM non sono
stati avviati per il collaudo reale.

NATHION_MEMORY_EMBEDDING_MODEL=mxbai-embed-large:latest è attivo nel .env di
questo PC e usa il modello Ollama già installato. Lascia vuoto per sola ricerca
per parole. La UI mostra quante memorie sono indicizzate e consente di
indicizzare quelle mancanti, dieci alla volta. Modifica e cancellazione
invalidano o rimuovono i vettori. La ricerca ripiega su BM25 quando necessario,
indicando il percorso usato nell'header X-Memory-Retrieval e nelle tracce.

`python scripts/check_memory.py` prova con modello reale la ricerca semantica
di una nota temporanea e la elimina alla fine. I modelli embedding non sono
scaricati dalle richieste dell'app. Le memorie passate agli agenti rimangono
verificabili con fonte e distinzione tra fatti e inferenze.

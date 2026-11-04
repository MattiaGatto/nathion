# Avvio e accesso

```powershell
docker compose -f docker-compose.yml -f docker-compose.voice.yml up -d --build
docker compose cp backend:/app/data/access-token.txt ./backend/data/access-token.txt
```

Apri http://localhost:4173 e incolla la chiave dal file locale
`backend/data/access-token.txt`. Non condividere questa chiave: dà pieno accesso
all'istanza personale. Il file è escluso da Git; il segreto originale è nel
volume backend. La chiave non viene inviata nei parametri URL o nei log.
L'autenticazione è attiva per impostazione predefinita; i test la disattivano
solo nelle fixture isolate. Non impostare NATHION_AUTH_ENABLED=false in uso normale.

La sessione browser usa un cookie HttpOnly, SameSite Strict con durata 8 ore;
su HTTPS ha anche Secure. Esci cancella il cookie del browser; una copia
sottratta di un cookie resta valida fino alla scadenza. Ruotare la chiave
nel volume invalida tutte le sessioni. Le richieste automatiche usano Bearer.
Il backend verifica l'origine delle scritture e dei WebSocket.

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

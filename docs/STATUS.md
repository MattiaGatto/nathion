# Stato verificabile di NATHION

La versione locale include le funzioni della prima roadmap utilizzabile.
Questo documento separa implementazione, prove ripetibili e verifiche che
richiedono dispositivi o servizi esterni.

| Area | Implementato | Limite o verifica esterna |
| --- | --- | --- |
| Foundation | Chat persistente, streaming, Ollama, SQLite, Docker, adattatore compatibile | LM Studio/vLLM non installati; adattatore provabile con Ollama /v1 |
| Voce | Whisper/Piper, Silero sul server, parziali manuali, turni automatici, frasi progressive, interruzione opzionale parlando | Microfono, eco, Bluetooth e sospensione Android da provare sul dispositivo |
| Orchestratore | 7 agenti configurabili, routing diretto, piani LLM da approvare, DAG validato, parallelismo, timeout, aggregazione | Nessuna garanzia automatica di correttezza del testo generato; job interrotti dichiarati, senza ripresa automatica |
| Skills | File versionati Markdown/YAML, discovery, validazione e selezione contestuale | Gestione dei file riservata all'operatore; nessun marketplace o upload non attendibile |
| Memoria | Categorie, fonte, fatti/inferenze, suggerimenti selettivi con salvataggio approvato, deduplica, BM25 e vettori locali, modifica e cancellazione | Qualità delle proposte da verificare; nessun salvataggio indiscriminato delle conversazioni |
| Multi-agent voice | Profili Piper distinti, coda centrale, ascolto sequenziale dei contributi degli agenti | Ascolto sul telefono da accettare con prova reale |
| Mobile | APK firmato con certificato privato, HTTPS sulla rete Tailscale, profilo e account; disponibile anche PWA | Installazione, microfono e prova da rete mobile sul telefono fisico |
| Tool engine | Registry, calcolatrice/orologio, strumenti nei piani validati, MCP HTTP con allowlist, consenso e traccia | MCP richiede server scelti dall'operatore; nessuna shell o navigazione web arbitraria |
| Operazioni | Programmazioni persistenti, stato aggregato, cancellazione, export e backup SQLite verificato | PC acceso necessario; nessuna sincronizzazione fra installazioni indipendenti |

Verifiche automatiche del 5 novembre 2026: 90 test backend isolati, 7 test
frontend su turni, audio e suddivisione delle frasi; compilazione Vite 8 e
controllo npm senza vulnerabilità segnalate. La schermata login è stata
controllata nel browser a dimensione desktop e a 390 px, senza overflow.

`./scripts/verify.ps1 -LocalAI` esegue anche prove reali con Ollama,
Whisper/Piper, Nginx, workflow, ricerca semantica, cancellazione, MCP locale,
worker, proposte e account. I report sono in `backend/data/voice-check/` e
rimangono esclusi da Git. Le prove sintetiche non sostituiscono il microfono.
La verifica delle sessioni server su loopback non certifica un cookie browser
su HTTPS: il report degli account distingue esplicitamente le due cose.

Sul PC sono passati il ciclo Whisper → Ollama → Piper su audio sintetico,
il workflow reale con due agenti, la ricerca semantica, le due voci, la
cancellazione, il test MCP su un server locale temporaneo e il worker delle
programmazioni. Sono passati anche piano strutturato e suggerimenti con
llama3.2:3b, il provider compatibile su Ollama /v1 e il flusso reale ospite:
approvazione, modello consentito, dati isolati e sessione revocata. Il backup
manuale ha superato `PRAGMA integrity_check` ed è stato copiato sul PC.
Il gateway APK usa la rete privata Tailscale con un certificato dedicato.
Il collaudo HTTPS dal PC è passato. Serve una prova dal telefono su rete mobile.


La migrazione multiutente crea un backup prima di modificare lo schema;
i dati precedenti restano di Mattia. Gli invitati hanno dati separati,
modelli e quota approvati. Un ospite di prova viene sospeso e ripulito dopo
il collaudo, mantenendo soltanto un account disabilitato di audit.

Un knowledge graph non è necessario per il volume e i casi d'uso attuali:
SQLite, ricerca ibrida e relazioni dei workflow coprono la prima versione.
Neo4j resta un'estensione motivabile da esigenze future, come previsto nella
costituzione. Non vengono dichiarate ricerche web o strumenti mai eseguiti.

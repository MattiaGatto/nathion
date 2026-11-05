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

Il desktop offre login, storico delle chat, profilo con foto e un microfono
centrale. La parola «Ehi Nathion» funziona durante l'ascolto abilitato nel
browser. La risposta appare in chat e viene letta con Piper.

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

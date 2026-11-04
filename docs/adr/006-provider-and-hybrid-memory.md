# ADR 006 — Provider compatibile e retrieval locale ibrido

Ollama resta predefinito. Un server compatibile si abilita solo con
NATHION_COMPATIBLE_BASE_URL (radice v1), con eventuale NATHION_COMPATIBLE_API_KEY
conservata come SecretStr. Nessun endpoint remoto è attivato implicitamente.
Il gateway usa elenco modelli e Chat Completions SSE senza SDK aggiuntivi.
La preferenza persistita è usata da REST, WebSocket e workflow.
Contratti verificati con MockTransport, non con LM Studio/vLLM reali.
Riferimenti: https://lmstudio.ai/docs/developer/openai-compat/chat-completions
e https://lmstudio.ai/docs/developer/openai-compat/models.

Ogni agente può salvare modello, accesso alla memoria e timeout tramite API;
il modello è modificabile nel Centro di controllo. Le configurazioni sono
validate e persistite in AppSettings, separate dalle definizioni di base.

La memoria combina BM25 e coseno sui vettori normalizzati con reciprocal rank
fusion. I vettori sono in una nuova tabella SQLite e includono il modello;
dimensioni diverse non vengono confrontate. Si considerano massimo mille
memorie per indice, con i primi risultati nel contesto. Qdrant non è ancora
necessario a questo volume; il modulo memory è sostituibile.

L'API Ollama /api/embed usa NATHION_MEMORY_EMBEDDING_MODEL. Se non configurato
o non raggiungibile viene dichiarato il percorso BM25/fallback nell'header
e nella traccia del workflow. Un errore di indicizzazione non perde la memoria.
La UI mostra indicizzate/totali e permette reindicizzazione limitata a dieci
elementi e sessanta secondi per richiesta. Modificare una memoria invalida
il vecchio vettore; eliminarla elimina i vettori. Nessun download implicito.
keep_alive=0 riduce la permanenza del modello embedding in RAM sul PC da 16 GB.

Prova reale superata con mxbai-embed-large:latest già installato: la memoria
"L'automobile è parcheggiata in garage." è recuperata cercando "Dove si trova
la macchina?", senza termini condivisi. È un controllo funzionale, non una
valutazione statistica. Il modello è attivo nel .env locale, non imposto
a tutte le installazioni. API: https://docs.ollama.com/api/embed.

Il parser skills supporta YAML con safe_load e validazione; PyYAML è una
dipendenza esplicita anziché una dipendenza indiretta del pacchetto vocale.

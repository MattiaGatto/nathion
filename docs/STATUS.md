# Stato verificabile del prodotto

Il progetto non è ancora completo rispetto alla costituzione. Questo file
distingue capacità effettive da lavoro ancora richiesto.

| Area | Implementazione attuale | Lavoro ancora richiesto |
| --- | --- | --- |
| Foundation | Chat, Ollama, SQLite, Docker, gateway astratto | Altri provider reali |
| Voce | Whisper/Piper locali, filtro Silero, WS, parziali e coda per frasi, stop manuale | Fine turno e interruzione automatiche, prova microfono/browser |
| Orchestratore | 7 agenti, routing per regole, DAG, parallelismo limitato, timeout, aggregazione | Piani LLM validati, configurazione persistente per agente, job riprendibili |
| Skills | Discovery file, metadata validati, selezione e caricamento per agente | Composizione e gestione UI delle skills |
| Memoria | SQLite, categorie, provenienza, certezza, deduplica, BM25, UI | Embedding e retrieval ibrido, aggiornamento/sintesi selettiva |
| Multi-agent voice | Coda audio di una risposta | Profili distinti e ascolto del dialogo tra agenti |
| Mobile | UI responsive, manifest, service worker, proxy, autenticazione | Prova telefono, HTTPS/Tailscale configurati nell'ambiente reale |
| Tool engine | Registry, calcolatrice e orologio con permessi per agente, cancellazione memoria con approvazione persistita | Tool calling LLM dinamico, MCP e altri adattatori |
| Advanced | Timeline persistita, errori e timeout | Automazioni e monitoraggio; knowledge graph solo se necessario |

L'assenza di un tool viene dichiarata nelle istruzioni degli agenti; un Research
Agent non viene presentato come una ricerca web eseguita. La presenza di un
manifest non equivale a installazione mobile verificata. Le prove audio
sintetiche non equivalgono a una conversazione registrata dal microfono.

Il 5 novembre sono state verificate le API protette dietro Nginx, login/logout,
asset PWA, skills, memoria esplicita e un DAG reale architect → coding con
aggregazione Ollama. Il primo tentativo era scaduto; il successivo con budget
esplicito ha completato l'esecuzione. Il report iniziale mostrava una sintesi
troncata al limite token: è stata quindi aggiunta la gestione esplicita di
done_reason=length e un limite di verbosità nelle istruzioni degli agenti.
Il completamento del trasporto non dimostra qualità generale del modello.

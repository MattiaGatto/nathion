# Stato verificabile del prodotto

Il progetto non è ancora completo rispetto alla costituzione. Questo file
distingue capacità effettive da lavoro ancora richiesto.

| Area | Implementazione attuale | Lavoro ancora richiesto |
| --- | --- | --- |
| Foundation | Chat, Ollama, SQLite, Docker, adattatore compatibile opt-in | Collaudo reale LM Studio/vLLM o provider remoto configurato |
| Voce | Whisper/Piper locali, filtro Silero, WS, parziali e coda per frasi, cancellazione chat e audio | Fine turno e interruzione automatiche, prova microfono/browser |
| Orchestratore | 7 agenti configurabili, routing per regole, DAG, parallelismo limitato, timeout, aggregazione | Piani LLM validati, job riprendibili |
| Skills | Discovery file, metadata validati, selezione e caricamento per agente | Composizione e gestione UI delle skills |
| Memoria | SQLite, categorie, provenienza, certezza, deduplica, BM25 + vettori locali, modifica e ricerca UI | Estrazione e sintesi automatica selettiva, valutazione su dati reali |
| Multi-agent voice | Profili Piper distinti, coda unica, ascolto dei contributi finali degli agenti | Prova di ascolto reale, conversazione full duplex |
| Mobile | UI responsive, PWA, proxy, account e inviti, permessi e quote | Prova telefono, HTTPS/Tailscale configurati nell'ambiente reale |
| Tool engine | Registry, calcolatrice/orologio con permessi, approvazioni, MCP HTTP con allowlist e consenso | Tool calling LLM dinamico e connessioni reali scelte dall'utente |
| Advanced | Timeline, errori, timeout, automazioni locali persistenti | Monitoraggio esteso; knowledge graph solo se necessario |

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

L'accesso multiutente include migrazione SQLite con backup preventivo,
propriet� dei dati, test di isolamento HTTP/WebSocket, inviti monouso,
approvazione, revoca, quote e operazioni amministrative. I test usano account
e database isolati. Il 5 novembre il comando Tailscale continua a dichiarare
Serve non abilitato; l'accesso HTTPS remoto non � quindi accettato come superato.

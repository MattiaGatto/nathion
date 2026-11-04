# ADR 004 — Workflow limitati e memoria esplicita

Un solo backend contiene registry agenti, registry skills e orchestratore.
La scelta automatica degli specialisti usa regole leggibili; non viene presentata
come pianificazione autonoma di un LLM. L'API accetta anche un DAG esplicito,
valida riferimenti e cicli, limita i task a otto e il parallelismo a due.
Una sola esecuzione globale è ammessa alla volta. Timeout per agente 60 s,
totale 180 s. Ogni piano, dipendenza, skill selezionata e risultato è persistito.
Una sintesi LLM aggrega realmente i risultati di più specialisti.

Le skills sono file SKILL.md amministrati dal proprietario, con frontmatter
JSON (sottoinsieme YAML), validato con Pydantic. Non carichiamo file allegati
alla chat come istruzioni fidate. Le skills sono selezionate per agente.

La memoria viene creata soltanto dall'utente. SQLite conserva contenuto,
categoria, fonte, certezza e impronta per deduplicazione. Il retrieval usa BM25
su massimo mille memorie recenti, e passa agli agenti massimo cinque risultati.
Non è retrieval vettoriale: embedding locali e ricerca ibrida restano da aggiungere.
Il contesto degli agenti viene inviato come messaggio utente separato dalle
istruzioni. Questo riduce la commistione, senza garantire immunità alla prompt injection.

Il Centro di controllo espone registry, esecuzioni, timeline e gestione memorie.
I workflow sono richieste HTTP limitate; non sono job durevoli ripresi dopo crash.
Gli agenti non dispongono ancora di tool eseguibili o navigazione web.

Accettazione: test di ciclo/riferimenti, dipendenze rispettate, skills pertinenti,
risultato persistito, memoria selettiva, deduplicazione, ricerca e cancellazione.

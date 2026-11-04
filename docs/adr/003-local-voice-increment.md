# ADR 003 — Motore vocale locale

Stato: implementato e verificato offline con modelli reali; microfono da validare.

Il Product Owner ha scelto di proseguire con la Milestone 2.
Il backend mantiene faster-whisper e Piper come dipendenze opzionali.
CPU int8 è il punto di partenza portabile; non assumiamo una GPU disponibile.
I modelli sono caricati solo al primo utilizzo, da percorsi configurati dal
proprietario. Nessun download viene attivato dalle richieste degli utenti.

Le registrazioni sono limitate a 8 MiB e 60 secondi decodificati; il browser
si ferma a 55 secondi. L'inferenza è serializzata e le richieste sovrapposte
sono rifiutate. Le registrazioni non sono conservate. La trascrizione viene
mostrata nel compositore per la revisione prima dell'invio.

HTTP resta disponibile per audio completi. Il client usa il WebSocket
`/api/voice/ws`: invia blocchi MediaRecorder e riceve trascrizioni parziali
su snapshot ogni almeno 4 secondi. La disponibilità dei parziali dipende
dal decoder del contenitore e dalla latenza CPU; non è riconoscimento token
per token. La trascrizione finale viene sempre richiesta separatamente.

Piper sintetizza segmenti di frase. Ogni WAV è accompagnato dal relativo testo;
il backend aspetta la conferma di fine riproduzione prima di produrre il
segmento successivo. La coda contiene al massimo un segmento, senza voci
sovrapposte. Stop o avvio di una registrazione fermano l'ascolto.
L'inferenza già avviata nel thread può terminare, ma non si avviano i segmenti
successivi. Il motore rimane occupato fino alla fine del lavoro nativo anche
se il client cancella la richiesta: nessuna coda illimitata dopo disconnessione.

Whisper Tiny è il modello iniziale leggero; lo script di preparazione supporta
anche base e small. Le revisioni scaricate e gli SHA-256 sono nel manifest
locale. PyAV è limitato alla serie 16: la 19 ha rimosso un parametro usato
da faster-whisper 1.2.1, incompatibilità verificata durante la prova reale.

Rischi: latenza CPU, modelli mancanti, compatibilità browser, licenze delle
voci e del motore Piper da valutare prima di redistribuire il prodotto.
Autenticazione ancora assente: uso locale finché non viene implementata.
Il limite di durata è verificato dopo decodifica: isolamento del decoder e
limiti di memoria di processo restano necessari prima di accettare file non fidati.

Restano VAD continuo con rilevamento automatico della fine turno, ascolto
continuo, barge-in automatico, cancellazione della generazione LLM e prova
microfono/browser. Le porte Docker sono limitate a 127.0.0.1.

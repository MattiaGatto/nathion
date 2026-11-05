# ADR 007 — Cancellazione e voci degli agenti

La chat mantiene un ricevitore WebSocket attivo mentre un task separato
consuma lo streaming LLM. Il messaggio tipizzato cancel cancella il task e
chiude il client HTTP del provider; la disconnessione esegue lo stesso cleanup.
Solo una risposta completata è salvata come messaggio assistant. Un utente
può inviare altri messaggi dopo l'ack cancelled. Restano compatibili i messaggi
testuali non incapsulati; i messaggi strutturati usano type=message e content.
La validazione REST e WS rifiuta testo vuoto e oltre 12000 caratteri.

I profili Piper sono nomi associati a percorsi configurati dall'operatore,
mai percorsi arbitrari inviati dal client. Default usa Paola; il profilo
riccardo usa il modello italiano x_low aggiuntivo, scaricato esplicitamente
con setup_voice.py --include-second-voice. Modelli e licenze restano nella
directory models ignorata da Git. Verificare le licenze prima di redistribuire.

Gli agenti salvano voice_profile nella propria configurazione. La UI permette
di ascoltare i contributi finali di un workflow con nomi, testo e profili
distinti. Sono risultati osservabili degli agenti, non ragionamenti privati
del modello. La coda limita segmenti e testo e attende il termine di ogni WAV.
Un arbitro audio browser unico impedisce sovrapposizioni tra chat e workflow;
iniziare un nuovo ascolto o una registrazione ferma il precedente.

Questo non implementa ascolto continuo, riconoscimento automatico della fine
turno o barge-in vocale automatico. L'interruzione si attiva con un pulsante.
La cancellazione dello streaming LLM non implica l'uccisione di thread nativi
già in esecuzione per STT/TTS: questi restano limitati dal motore vocale.

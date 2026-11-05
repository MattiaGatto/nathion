# ADR 011 — Turni vocali e proposte controllate dal modello

Stato: accettato, 5 novembre 2026.

La conversazione continua deve funzionare con Whisper e Piper sul PC,
senza servizi cloud obbligatori. Il browser acquisisce PCM tramite
AudioWorklet, mantiene un breve pre-roll e rileva energia sostenuta e pausa.
Il server applica Silero alla trascrizione finale. Non è presentato come
VAD neurale nel browser: soglia e cancellazione dell'eco dipendono dal
microfono. L'interruzione parlando è opt-in e consigliata con cuffie.

La modalità automatica richiede avvio esplicito, indica che invia le frasi,
limita la durata, si ferma quando la pagina diventa nascosta e chiude il
microfono dopo inattività. La coda suddivide il testo in arrivo per frasi;
un proprietario audio unico impedisce sovrapposizioni tra chat e pannelli.
Stop e cambio contesto annullano richieste e riproduzione; l'inferenza vocale
nativa già iniziata conserva il lock finché termina.

Il modello può proporre un piano strutturato con agenti, dipendenze e tool
consentiti. Il server valida il grafo e l'utente vede passaggi modificabili
prima di approvarli. JSON non valido, tool non consentiti e cicli vengono
rifiutati. I piani non autorizzano shell o MCP arbitrari; le chiamate MCP
continuano a richiedere una richiesta di approvazione separata.

La memoria selettiva analizza solo messaggi utente, propone fino a cinque
informazioni e non le salva automaticamente. Fonte e stato di inferenza sono
imposti dal server; l'utente modifica, scarta, salva o conferma come fatto.

Due slot condivisi limitano chat, agenti ed embedding; la voce ha un lock
separato. Le richieste eccedenti falliscono esplicitamente. I test coprono
turni sintetici, WAV, frasi, validazione di piani, assenza di effetti automatici,
isolamento dei suggerimenti e rilascio degli slot. Il collaudo acustico Android
richiede il dispositivo e un collegamento HTTPS privato effettivamente attivo.

La prova reale con llama3.2:3b ha evidenziato una combinazione coding/calculator
non autorizzata, correttamente rifiutata. Ollama usa quindi un JSON Schema con
varianti per agente che vincola anche i tool ammessi. I provider senza questa
capacità conservano la validazione del risultato, senza dichiarare garanzie
di decodifica vincolata né eseguire retry silenziosi.

# Voce locale — Milestone 2

## Avvio

I modelli sono già stati preparati su questo PC. Per ricreare l'ambiente,
dal backend con Python 3.12+ e dipendenze vocali installate:

```powershell
python scripts/setup_voice.py
```

Lo script scarica Whisper Tiny e Piper Paola italiano, salva revisioni e
checksum in `models/manifest.json` e verifica gli SHA-256 LFS pubblicati.
È possibile scegliere `--size base` o `--size small` per Whisper.
I file prodotti nella directory `models/` del repository sono:

- `whisper/`: un modello CTranslate2 completo compatibile con faster-whisper.
- `voice.onnx` e `voice.onnx.json`: una voce Piper italiana e la sua configurazione.

Scarica i modelli dai rispettivi progetti ufficiali e verifica la licenza della
voce scelta. Le richieste vocali non scaricano modelli automaticamente.

```powershell
docker compose -f docker-compose.yml -f docker-compose.voice.yml up --build
```

Per avvio senza Docker, nel backend usa Python 3.12+:

```powershell
pip install -e ".[dev,voice]"
$env:NATHION_VOICE_ENABLED = "true"
$env:NATHION_WHISPER_MODEL_PATH = "../models/whisper"
$env:NATHION_PIPER_MODEL_PATH = "../models/voice.onnx"
$env:NATHION_OLLAMA_BASE_URL = "http://localhost:11434"
uvicorn app.main:app --host 127.0.0.1
```

Avvia il frontend come descritto nel README. Usa localhost o HTTPS per il
permesso microfono. Premi **Registra voce**, parla, poi **Termina e trascrivi**.
Rivedi il testo e invialo. **Ascolta ultima risposta** usa Piper locale;
**Interrompi audio** ferma riproduzione o registrazione e impedisce la
sintesi dei segmenti successivi. Una nuova registrazione interrompe l'ascolto.
La generazione LLM e l'inferenza server già avviate non sono cancellate.
Risposte oltre 4000 caratteri restano testuali in questo incremento.

L'audio viaggia via WebSocket. Durante la registrazione il server tenta una
trascrizione parziale ogni almeno 4 secondi, senza accodare inferenze. Su
dispositivi o formati che non permettono decodifica parziale, il testo arriva
alla fine. La risposta vocale è suddivisa in frasi WAV, con una sola frase
in coda: testo del segmento e audio vengono trasmessi insieme.

Silero VAD filtra il silenzio nella trascrizione. Non c'è ancora rilevamento
continuo della fine turno: premi **Termina e trascrivi** quando hai finito.

## Verifiche ripetibili

Dal backend con le dipendenze vocali installate:

```powershell
python scripts/check_voice.py
python scripts/check_stack.py
```

Il primo controllo funziona offline e verifica Piper → WAV → Silero VAD →
Whisper. Il secondo richiede i container e Ollama attivi: usa il WebSocket
audio, crea una conversazione "Verifica voce locale", verifica la risposta
persistita e riceve i WAV della sintesi. Non usa il microfono. Audio e report
di questi controlli espliciti sono in `backend/data/voice-check/` e sono
esclusi da Git. Le registrazioni normali dell'app non sono salvate.

## Criteri di accettazione

- [ ] Microfono reale: frase italiana trascritta e modificabile prima dell'invio.
- [x] Trascrizione inviata alla chat con risposta Ollama reale persistita.
- [ ] Piper produce una risposta udibile, arrestabile dal browser.
- [ ] Cambio conversazione smette di registrare/riprodurre e ignora risultati vecchi.
- [x] Motore STT/TTS offline con modelli già presenti (audio sintetico).
- [x] Docker Compose vocale avviato e verificato tramite API.

I test automatici coprono contratti API, disattivazione, errori, validazione
e limiti di upload con adattatori sostituiti. Non dimostrano accuratezza STT,
qualità TTS, permessi microfono o funzionamento dei modelli reali.

Verifica offline del 2 novembre 2026: frase italiana di 3,44 s generata
da Piper e trascritta da Whisper Tiny. Primo caricamento incluso:
18,83 s sintesi, 9,34 s trascrizione. Il risultato conserva la frase di
test, ma omette il saluto iniziale: non è una misura di accuratezza generale.
Motori: faster-whisper 1.2.1, Piper 1.8.0, PyAV 16.1.0 su Windows CPU.

Verifica del 5 novembre 2026: percorso WebSocket STT → Ollama llama3.2:3b
→ persistenza → WebSocket TTS superato. Risposta sintetizzata: "Sono pronto
a rispondere alle tue domande!", WAV ricevuto di 90668 byte. Report locale
in `backend/data/voice-check/stack-report.json`. Prova microfono e ascolto
dal browser restano da eseguire.

Non ancora implementati: fine turno automatica, conversazione continua,
barge-in automatico e autenticazione. Le porte Docker sono vincolate a
localhost. Non esporre il servizio a rete locale o Internet in questo stato.

Riferimenti: [faster-whisper](https://github.com/SYSTRAN/faster-whisper),
[Piper Python API](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/API_PYTHON.md).

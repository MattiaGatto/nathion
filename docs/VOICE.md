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
pip install -e ".[voice,mcp]"
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
Il pulsante Interrompi risposta cancella lo stream LLM. Un'inferenza vocale
nativa già avviata può terminare nel server prima di liberare il motore.
Risposte oltre 4000 caratteri restano testuali in questo incremento.

L'audio viaggia via WebSocket. Durante la registrazione il server tenta una
trascrizione parziale ogni almeno 4 secondi, senza accodare inferenze. Su
dispositivi o formati che non permettono decodifica parziale, il testo arriva
alla fine. La risposta vocale è suddivisa in frasi WAV, con una sola frase
in coda: testo del segmento e audio vengono trasmessi insieme.

Silero VAD filtra il silenzio nella trascrizione finale.

## Conversazione vocale automatica

**Avvia conversazione vocale** mantiene il microfono attivo nella pagina.
Un AudioWorklet locale rileva energia sostenuta (220 ms) e fine turno dopo
900 ms di silenzio. Conserva fino a 500 ms iniziali per non tagliare l'attacco;
ogni turno è limitato a circa 54 secondi. Il WAV mono 16 kHz viene trascritto
sul PC e inviato alla chat automaticamente. Il testo in arrivo alimenta una
coda di frasi Piper; solo un proprietario audio può riprodurre o registrare.

**Interrompi parlando** annulla voce e generazione quando viene rilevato un
nuovo turno. È opzionale: usa cuffie e regola la soglia in ambienti rumorosi,
perché cancellazione eco e rilevamento energetico dipendono dal dispositivo.
L'AudioWorklet decide i turni; Silero sul server filtra il contenuto finale.
Non vengono dichiarati risultati equivalenti a un VAD neurale nel browser.

La sessione si chiude cambiando conversazione, aprendo i pannelli,
nascondendo la pagina, perdendo la connessione o dopo 20 secondi di ascolto senza voce. Il timer attende il completamento della
trascrizione e della risposta in corso.
Puoi terminarla sempre dal pulsante. Le acquisizioni non vengono salvate;
restano i messaggi inviati esplicitamente o dalla sessione attiva. Un calcolo
nativo già avviato può finire dopo lo stop, ma non viene accodato altro audio.
I test su segnali e formati sintetici non sostituiscono una prova del microfono
su Android, compresi eco, rumore, Bluetooth, sospensione e riconnessione.

## Parola di attivazione su desktop

Premi il microfono una volta per armare l'ascolto e autorizzalo nel browser.
Mentre la pagina resta visibile, il rilevatore invia a Whisper sul PC solo
i segmenti in cui rileva voce. Dopo «Ehi Nathion» puoi fare la domanda
nello stesso turno oppure nel turno successivo. Una volta iniziata la
conversazione, si applica la chiusura dopo 20 secondi in ascolto senza voce.
Per disarmare, premi di nuovo il microfono o cambia pagina.

Riferimenti: [faster-whisper](https://github.com/SYSTRAN/faster-whisper),
[Piper Python API](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/API_PYTHON.md).

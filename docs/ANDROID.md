# NATHION su Android

## APK per il PC di Mattia

Il file firmato NATHION 1.1 si trova in `android/build/NATHION.apk`. Puoi installarlo sopra la versione 1.0 per mantenere il server memorizzato. Copialo sul telefono
via USB o attraverso un canale privato. Aprilo dal gestore file di Android e
consenti al gestore di installare l'app se Android lo richiede.

Connetti Tailscale sul telefono con lo stesso account del PC. Apri NATHION,
premi **Connetti al PC** sull’indirizzo precompilato e accedi con l’email e la password dell’app. Se il browser sul PC usa già una sessione, l'APK richiede comunque
le proprie credenziali. **Profilo** contiene i dati personali e la funzione Esci.
Per registrare un ospite serve un invito emesso dall'amministratore.

L'ingresso HTTPS Docker ascolta soltanto sull'indirizzo privato Tailscale
del PC. L'APK contiene il certificato pubblico della CA del progetto, valido
per il nome preconfigurato. Il telefono può usare la rete mobile con Tailscale connesso. Il PC, Docker, Ollama e Tailscale devono restare accesi.
Il certificato privato è previsto per l'APK e il normale browser Android non
lo riconosce senza una configurazione di fiducia separata.

## Uso vocale

Tocca il microfono, consenti il permesso Android e pronuncia **Ehi Nathion**
seguito dalla richiesta. Per chiamare uno specialista, dì per esempio
**Ehi Nathion, chiedi a Vega di leggere il manuale**. In modalità voce la chat
resta dietro la console. Il colore viola indica che hai chiamato un agente.
**Mostra chat** riporta alla conversazione. Durante la lettura, **Tocca per parlare** ti ridà il turno. Dopo 20 secondi di inattività puoi
toccare di nuovo il microfono per continuare senza ripetere la parola chiave.
Tieni NATHION in primo piano e usa l’orientamento verticale. In **Opzioni vocali**
puoi abilitare l’interruzione parlando, preferibilmente con le cuffie.

**Impostazioni → Modifica profilo** apre foto, dati personali e bio Markdown.
In **Agenti → Studio → Documenti** puoi allegare un file dal selettore Android.
**Registro attività → Esporta registro JSON** apre la scelta della cartella
in cui salvare il file. Il menu **Connessione PC** permette di ricaricare o
cambiare il server.

Sul PC di Mattia sono attivi Whisper Small per la trascrizione e Piper Ugo
Medium per la voce iniziale della console. Puoi scegliere Paola o Riccardo
in **Opzioni vocali**. Vedi [Voce locale](VOICE.md) per i modelli e l’installazione.

Il modello di chat predefinito sul PC di Mattia è `llama3.2:3b`. In una
prova breve a modello già caricato il primo testo è arrivato in 0,08 s,
contro 0,14 s per `qwen3.5:4b`, e la risposta completa ha richiesto circa un
secondo. Queste misure riguardano Ollama e non comprendono rete, trascrizione
o sintesi. Qwen 3.5 4B è la scelta multimodale tra i modelli installati.


Esempi di comandi vocali

- **Chiedi agli agenti di organizzare il backup** avvia un'attività consultabile in Agenti.
- **Mostra lo stato del PC**, **Apri Calcolatrice sul PC** e **Apri Blocco note sul PC**
  creano una richiesta da approvare come amministratore.
- **Apri le impostazioni del telefono** mostra una conferma Android e apre
  le impostazioni se confermi.

Il connettore Windows accetta soltanto le azioni elencate. NATHION non dispone
di accesso generico a schermo, file, messaggi o altre app.

## Ricompilazione sul PC

Per predisporre la configurazione privata esegui `scripts/android-private.ps1`
sul PC con Tailscale connesso. Lo script genera i certificati in una cartella
locale ignorata da Git e aggiorna Docker per aggiungere il gateway mobile.
Esegui `start.ps1` per avviare i servizi. Il connettore si configura con
`scripts/start-pc-connector.ps1` e richiede l'ambiente Python del progetto con
l'extra MCP installato. I successivi avvii lo riutilizzano.

Per firmare l'APK, `android/build-apk.ps1` usa JDK 17, Android SDK Platform 35
e Build Tools 35.0.0. Estrai i pacchetti rispettivamente sotto
`android/.tools/jdk`, `android/.tools/platform` e `android/.tools/build-tools`.
Conserva la chiave di firma e i certificati in `android/.signing` sul PC.
Per distribuire un aggiornamento usa la stessa chiave e aumenta `-VersionCode`.
Le chiavi private restano fuori dall'APK.

Per un'altra installazione con Tailscale Serve già attivo, un APK compilato
senza configurazione privata può accettare un indirizzo HTTPS `.ts.net` con
certificato pubblico. La procedura PWA rimane disponibile.

## Alternativa PWA con Tailscale Serve

Questa procedura usa un certificato pubblico Tailscale e si applica alle
installazioni che usano Serve al posto del gateway APK sulla porta 8443.

1. Installa Tailscale su PC e Android dai canali ufficiali e accedi alla stessa
   rete privata. Se richiesto, completa l'abilitazione HTTPS nel tuo account.
2. Avvia NATHION con `./start.ps1`.
3. Esegui `./scripts/android-access.ps1` dal PC. Lo script prepara l'origine
   HTTPS effettiva, cookie Secure e Tailscale Serve sulla porta 8443. Non usa
   Funnel e non apre il servizio al pubblico. Se Tailscale propone modifiche
   a una configurazione esistente, rivedile prima di confermare.
4. Apri l'indirizzo mostrato in Chrome Android con Tailscale connesso e usa
   email e password. Su una nuova installazione, al primo accesso usa la password in
   `backend/data/admin-initial-password.txt` e sostituiscila. Non usare o
   condividere la chiave operatore con gli ospiti.
5. Consenti il microfono, registra una frase, controlla la trascrizione e inviala.
   Ascolta la risposta e verifica i pulsanti di interruzione. Installa la PWA
   usando l'opzione proposta dal browser.

Checklist di accettazione ancora manuale:

- [ ] Sessione autenticata e riconnessione dopo chiusura della PWA.
- [ ] Permesso microfono e frase italiana trascritta correttamente.
- [ ] Audio udibile e interruzione immediata senza sovrapposizioni.
- [ ] Cambio conversazione durante registrazione o ascolto.
- [ ] Accesso tramite rete privata anche fuori dalla rete Wi-Fi del PC.

Riferimento ufficiale: https://tailscale.com/docs/reference/tailscale-cli/serve.

## Altre persone

Un'installazione indipendente ha Docker, Ollama e modelli sul proprio PC,
il proprio amministratore e il proprio accesso Tailscale. La PWA si installa
aprendo l'indirizzo HTTPS di quel PC: i dati restano su quell'istanza.

Un ospite che usa il PC di Mattia riceve un invito NATHION e attende
l'approvazione. Serve anche l'accesso di rete: due tailnet personali separate
non comunicano automaticamente. Autorizza l'appartenenza alla rete o condividi
la macchina secondo i controlli Tailscale. L'invito NATHION non modifica ACL,
account o impostazioni Tailscale. Non è richiesto Docker sul solo telefono.

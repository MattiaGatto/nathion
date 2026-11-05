# Collaudo Android

La parte applicativa è pronta per HTTPS same-origin. Tailscale è stato
installato su questo PC ed è connesso. L'abilitazione Serve deve risultare
effettiva nel proprio account prima che l'URL HTTPS sia utilizzabile.
Permesso microfono e collaudo sul telefono richiedono il proprietario.

1. Installa Tailscale su PC e Android dai canali ufficiali e accedi alla stessa
   rete privata. Se richiesto, completa l'abilitazione HTTPS nel tuo account.
2. Avvia NATHION con `./start.ps1`.
3. Esegui `./scripts/android-access.ps1` dal PC. Lo script prepara l'origine
   HTTPS effettiva, cookie Secure e Tailscale Serve sulla porta 8443. Non usa
   Funnel e non apre il servizio al pubblico. Se Tailscale propone modifiche
   a una configurazione esistente, rivedile prima di confermare.
4. Apri l'indirizzo mostrato in Chrome Android con Tailscale connesso e usa
   nome utente e password. Per Mattia, al primo accesso usa la password in
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

Lo script è stato controllato ed eseguito fino alla richiesta di abilitazione
Serve da parte di Tailscale. Serve un collaudo reale sul telefono. Il PC resta
il motore AI e deve rimanere acceso. Riferimento ufficiale:
https://tailscale.com/docs/reference/tailscale-cli/serve.

## Altre persone

Un'installazione indipendente ha Docker, Ollama e modelli sul proprio PC,
il proprio amministratore e il proprio accesso Tailscale. La PWA si installa
aprendo l'indirizzo HTTPS di quel PC: i dati restano su quell'istanza.

Un ospite che usa il PC di Mattia riceve un invito NATHION e attende
l'approvazione. Serve anche l'accesso di rete: due tailnet personali separate
non comunicano automaticamente. Autorizza l'appartenenza alla rete o condividi
la macchina secondo i controlli Tailscale. L'invito NATHION non modifica ACL,
account o impostazioni Tailscale. Non � richiesto Docker sul solo telefono.

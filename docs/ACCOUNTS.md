# Account e installazioni

Mattia è l'amministratore della propria istanza. Nome e nome visualizzato del
primo amministratore si configurano prima del primo avvio; gli account già
creati non vengono rinominati da una variabile d'ambiente.

## Primo accesso

Accedi con l'indirizzo configurato in `NATHION_ADMIN_EMAIL`. Su una nuova
installazione, `./start.ps1` copia la password iniziale nel file ignorato
`backend/data/admin-initial-password.txt`. La password deve essere cambiata
prima di usare le funzioni. Il file nel container viene eliminato dopo il
cambio; la copia locale può essere rimossa, perché non è più valida.
La chiave `access-token.txt` è un segreto operatore separato per script e recupero.

La migrazione assegna a Mattia i dati precedenti e, se il database SQLite
contiene lo schema precedente, ne crea prima una copia in `/app/data/backups/`.
I nuovi record appartengono all'utente autenticato. Filtri ORM e controlli
sulle scritture proteggono chat, messaggi, memorie, vettori, attività e azioni.
Le preferenze di modello e agente sono personali. L'export ordinario include
solo i dati personali; l'amministratore ha un export esplicito per account.
Il proprietario della macchina può comunque leggere il database e i backup.

## Invitare un ospite sul proprio server

La modalità personale è attiva per impostazione predefinita. Per abilitare
gli inviti, imposta `NATHION_PERSONAL_MODE=false` in `.env` e riavvia il backend.

1. Apri **Centro di controllo → Utenti e accesso al server**.
2. Crea un invito: dura sette giorni ed è monouso. Copia il link privato,
   preferibilmente dalla pagina aperta sull'indirizzo HTTPS Tailscale.
3. La persona sceglie nome utente e password; l'account resta in attesa.
4. Approva l'account, abilita l'uso del PC, seleziona i modelli Ollama e una
   quota. Zero richieste blocca i nuovi calcoli. Salva le autorizzazioni.
5. Autorizza separatamente l'accesso di rete Tailscale. L'invito dell'app non
   collega reti private e non condivide automaticamente il PC.

Ogni chiamata LLM (anche di un singolo agente), operazione vocale e embedding
conta nella quota UTC giornaliera. I tentativi di calcolo autorizzati possono
consumare quota anche se il modello fallisce. I workflow possono richiedere più
chiamate. Gli ospiti usano solo Ollama locale e i modelli concessi; MCP,
programmazioni e strumenti amministrativi restano riservati al proprietario.
Le memorie personali si possono creare, modificare, cercare ed eliminare.
Una ricerca semantica non disponibile o senza quota ripiega sulla ricerca
per parole; il salvataggio esplicito della memoria rimane possibile.

Sospensione o modifica dei permessi revocano le sessioni. Il reset password
mostra una credenziale temporanea una sola volta e forza la sostituzione.
La cancellazione dei dati richiede prima la sospensione e non elimina copie
già esportate o backup. L'account sospeso resta registrato per impedire riusi
accidentali del nome. Inviti e password non vengono inviati automaticamente
per email o altri servizi.

## Installazione indipendente

Ogni persona può usare il repository sul proprio PC con Docker, Ollama e i
modelli locali, scegliere il proprio amministratore e configurare la propria
rete privata. Il telefono apre e installa la PWA dell'istanza scelta. Non
esistono sincronizzazione automatica né condivisione di dati tra installazioni.
Chi usa soltanto il telefono può usare un'istanza ospitata con le due
approvazioni distinte: account applicativo e accesso alla rete privata.

## Recupero amministratore

Conserva la chiave operatore sul PC e il volume Docker. Il recupero tramite
`POST /api/auth/admin/users/owner/password` richiede Bearer operatore e il
corpo `{"confirmation":"mattia"}` (adatta al nome configurato). Restituisce una
password temporanea una volta sola. Non inserire segreti nella riga di comando,
nei log, in URL o nel repository. Non è stato effettuato alcun reset del tuo
account durante i test.

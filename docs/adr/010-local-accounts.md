# ADR 010 — Account locali e accesso ospitato approvato

Stato: accettato, 5 novembre 2026. Sostituisce l'assunzione di un unico utente
nelle precedenti decisioni di autenticazione.

La stessa istanza deve avere Mattia amministratore e ospiti approvati, mentre
installazioni personali restano indipendenti. Usiamo account SQLite, password
Argon2id, sessioni opache revocabili e inviti monouso con hash nel database.
Il segreto operatore resta separato, locale e riservato al recupero/script.

Le tabelle personali hanno owner_id, predicati ORM sulle letture e DML,
controlli di proprietà immutabile e lookup che non si affidano alla identity
map di Session.get. Le preferenze usano chiavi per utente. Il database legacy
viene copiato con SQLite backup prima di assegnare i dati all'owner storico.

Accesso applicativo e accesso Tailscale sono due autorizzazioni distinte.
Gli ospiti non possono configurare provider esterni o MCP; il gateway verifica
modelli e grant effettivi e aggiorna atomicamente una quota per giorno UTC.
La quota include voce ed embedding. I workflow possono consumare più unità.
Il controllo ricorre durante gli stream e prima di nuove operazioni vocali;
un'inferenza nativa già iniziata può terminare dopo la revoca.

Test: isolamento tra due account su HTTP, WebSocket, memoria, preferenze,
export e cancellazioni; inviti monouso/revocati; approvazione, reset password,
revoca sessioni, quote condivise e migrazione non distruttiva con backup.

Conseguenze: i vecchi cookie vengono invalidati. Serve un nuovo accesso e la
scelta della password personale. L'admin gestisce dati ospiti solo mediante
operazioni esplicite, evitando che entrino nella sua memoria ordinaria.

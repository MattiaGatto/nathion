# ADR 005 — Accesso personale e strumenti limitati

L'autenticazione è attiva per default, con chiave locale generata una volta
nel volume dati, sessione HttpOnly di otto ore e Bearer per script locali.
Tutte le API e i WebSocket sono protetti; stato login e healthcheck sono pubblici.
Cinque tentativi di login al minuto e verifica Origin sulle scritture limitano
abusi semplici. La sessione firmata non ha revoca individuale lato server:
logout rimuove il cookie; la rotazione della chiave revoca tutte le sessioni.

Nginx espone pagina e API sullo stesso indirizzo e inoltra gli upgrade WS.
I dati API non entrano nella cache PWA. Porte pubblicate solo su loopback.
HTTPS/Tailscale e test microfono richiedono ancora configurazione e prova reali.

Gli strumenti sono allowlistati, non eseguono shell, filesystem o codice
arbitrario. Calcolatrice: AST ammesso limitato a numeri e aritmetica, 200
caratteri, 60 nodi, risultato finito entro 10^12, nessuna potenza o chiamata.
L'orologio legge l'ora UTC. La cancellazione memoria crea un'azione pendente
persistita; solo l'approvazione esplicita la esegue. Una modifica condizionale
nel database impedisce la doppia approvazione concorrente. Rifiuto preserva i dati.
L'interfaccia mostra la memoria interessata prima della decisione.

I tool attuali sono invocati dal proprietario via UI/API. Task espliciti
possono usare calcolatrice e orologio se l'agente ha quel permesso; il routing
"calcola ..." usa realmente la calcolatrice, senza chiedere il risultato a
un LLM. Il modello non può richiamarli liberamente. Tool calling LLM dinamico
e MCP rimangono lavoro distinto, non presentato come già implementato.

Ollama riceve limiti configurabili num_ctx=2048 e num_predict=512 per partire
su questo PC da 16 GB. Un contesto maggiore aumenta memoria e può troncare
meno cronologia, ma va scelto in base alle risorse. Questi limiti rendono
esplicito il budget; non dimostrano che il timeout precedente fosse causato
esclusivamente dalla memoria. Fonte: documentazione ufficiale API chat e Modelfile.

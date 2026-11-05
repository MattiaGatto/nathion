# ADR 008 — MCP HTTP con approvazione obbligatoria

L'adattatore usa l'SDK Python ufficiale MCP 2.x come extra opzionale.
Solo endpoint HTTP(S) presenti nella configurazione dell'operatore possono
essere contattati; ogni server ha una allowlist esplicita di tool. Nessun
subprocess o comando stdio viene accettato dal prodotto. Le intestazioni
segrete rimangono lato backend, mai nei parametri URL o nelle risposte API.

La discovery restituisce solo gli strumenti ammessi. Una chiamata crea
un'azione pendente con argomenti verificabili. Nessun tool remoto viene
eseguito prima dell'approvazione del proprietario. L'azione memorizza
l'impronta di endpoint, tool e credenziali: se la configurazione cambia
serve una nuova approvazione. Il claim atomico viene persistito prima
della rete; timeout, disconnessioni o crash danno esito unknown, senza retry
automatici o doppia esecuzione. Al riavvio le azioni executing diventano unknown.

Limiti: due connessioni simultanee, trenta secondi, argomenti 16000 caratteri,
risultato testuale 16000 caratteri con flag di troncamento, eventi SSE 128 KiB.
La UI mostra server, tool e argomenti prima di consentire l'approvazione.
Le descrizioni remote restano dati, non istruzioni di sistema. L'orchestratore
non invoca MCP liberamente tramite il modello: ogni chiamata remota attuale
parte dal pannello dell'utente e richiede conferma.

Collaudo: protocollo reale con server SDK in memoria e prova Streamable HTTP
su loopback con processo temporaneo controllato. Discovery, add(2,3)=5 e
approvazione sono verificati con database temporaneo. Nessun server esterno
o account personale viene configurato automaticamente.

Documentazione: https://py.sdk.modelcontextprotocol.io/client/
e https://py.sdk.modelcontextprotocol.io/client/transports/.

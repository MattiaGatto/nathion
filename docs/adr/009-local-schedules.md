# ADR 009 — Automazioni personali persistenti

Le programmazioni sono record SQLite con prossimo avvio UTC, intervallo,
modello locale, abilitazione e ultimo risultato. L'API richiede un fuso orario
e normalizza a UTC; la UI converte l'ora locale del browser. Gli intervalli
sono durate fisse, non ricorrenze di calendario: 24 ore possono cambiare ora
locale al cambio dell'ora legale.

Il worker interno controlla i job ogni due secondi. Non crea processi,
shell, messaggi verso terzi o chiamate MCP. Usa Ollama e lo stesso runtime
limitato dei workflow. Una sola attività alla volta è ammessa fra automazioni
e richieste manuali. Un claim condizionale persistito evita doppie esecuzioni.
Le scadenze perse a PC spento eseguono al massimo una volta alla ripresa,
senza accumulare raffiche. Riavvii o cancellazioni non rilanciano automaticamente
un tentativo già iniziato: lo stato diventa interrupted.

La pausa riguarda gli avvii futuri; l'attività già in corso conserva i propri
timeout. La cancellazione di una programmazione in corso è rifiutata.
Il deployment supportato è un unico backend; non è un cluster distribuito.
Non si promettono scadenze in tempo reale mentre il PC è spento o occupato.
Le esecuzioni e i risultati sono visibili nella timeline.

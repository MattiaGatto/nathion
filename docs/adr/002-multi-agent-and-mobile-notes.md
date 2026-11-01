# Nota di roadmap — Multi-agent configurabile, Mobile, Android Auto

**Stato:** Raccolta requisiti (non ancora implementata)
**Data:** 2026-11-01
**Riguarda:** Milestone 3 (Agent Orchestrator), Milestone 4 (Skills), Milestone 7 (Mobile & Remote Access)

## Requisiti raccolti dal Product Owner

1. **N agenti specializzati, ognuno con skill differenti**, che intervengono
   autonomamente quando hanno la competenza pertinente alla richiesta
   (routing per competenza, non assegnazione manuale). Coerente con
   costituzione §4.4 (Orchestrator) e §5 (Sistema multi-agent): l'elenco
   agenti li' presente (General Assistant, Software Architect, Coding
   Agent, Data Engineering Agent, AI Engineering Agent, Research Agent,
   Productivity Agent) resta il punto di partenza.

2. **Agenti personalizzabili dall'utente** tramite una sezione dedicata
   nell'interfaccia grafica (creare/modificare/disattivare agenti,
   assegnare skill, modello preferito, system instructions — i campi
   gia' elencati in §5). Questa sezione deve esistere **sia nella web
   app sia nella futura app mobile dedicata** (non solo desktop).

3. **Compatibilita' futura con Android Auto.** Da tenere presente fin
   da ora nelle scelte di Milestone 2 (voce) e Milestone 7 (mobile):
   Android Auto impone interazione prevalentemente vocale, risposte
   brevi, UI minimale a schermo e nessuna interazione che richieda
   input testuale prolungato alla guida. Non e' un requisito immediato,
   ma un vincolo di progettazione da non precludere (es. l'orchestratore
   deve poter restituire risposte "voice-first" sintetiche quando il
   client lo richiede).

## Impatto sulle decisioni gia' prese (Milestone 1)

Nessuna rottura: il gateway LLM astratto, il modello dati conversazioni
e l'endpoint `/api/settings` (key-value) sono gia' pensati per essere
estesi senza riscritture:

- **Agent Registry (Milestone 3)**: nuova tabella `agents` (id, nome,
  descrizione, system_instructions, skills[], modello preferito, tool
  autorizzati, limiti) + endpoint CRUD `/api/agents`. La sezione
  "Impostazioni" del frontend (`SettingsPanel.tsx`, introdotta in
  questa sessione) e' il punto naturale dove aggiungere una tab
  "Agenti" quando l'Agent Registry esistera'.
- **Routing per competenza**: l'Orchestrator (non ancora costruito)
  decidera' quale agente intervenire; il frontend non deve conoscere la
  logica di routing, solo mostrare "quale agente ha risposto" (gia'
  previsto in §4.1 "Visualizzazione degli agenti attivi").
- **Mobile (Milestone 7)**: la web app e' gia' responsive (Tailwind,
  niente layout fissi); una PWA installabile condividera' le stesse API
  REST/WebSocket. La sezione impostazioni-agenti andra' replicata li',
  non reinventata.
- **Android Auto**: nessuna azione ora. Da rivalutare quando si
  disegnera' la Milestone 2 (Voice Engine) — l'interfaccia vocale andra'
  pensata separabile dalla UI visiva fin da subito, cosi' da poter
  essere riusata in un contesto "schermo minimo, audio primario".

## Prossimo passo

Restiamo sulla Milestone 1 (chat testuale, gia' in corso di rifinitura
in questa sessione). L'Agent Registry e la UI di configurazione agenti
sono pianificati per la Milestone 3, come da roadmap — verranno
discussi con lo stesso processo (obiettivo → architettura → rischi →
implementazione incrementale) prima di scrivere codice.

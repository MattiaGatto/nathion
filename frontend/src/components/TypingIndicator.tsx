/** Tre puntini pulsanti mostrati mentre si attende il primo chunk dalla
 * risposta del modello (connessione aperta ma nessun token ancora). */
export function TypingIndicator() {
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 px-1 py-1">
      <span>Sto elaborando la risposta…</span>
      <span aria-hidden="true" className="flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-nathion-accent animate-pulse-dot"
            style={{ animationDelay: `${i * 0.18}s` }}
          />
        ))}
      </span>
    </div>
  );
}

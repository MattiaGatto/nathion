/** Tre puntini pulsanti mostrati mentre si attende il primo chunk dalla
 * risposta del modello (connessione aperta ma nessun token ancora). */
export function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-1 py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-nathion-accent animate-pulse-dot"
          style={{ animationDelay: `${i * 0.18}s` }}
        />
      ))}
    </div>
  );
}

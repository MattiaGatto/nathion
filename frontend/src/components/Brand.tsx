/**
 * Marchio NATHION: un nodo centrale connesso a tre satelliti, a
 * richiamare l'orchestratore che coordina agenti specializzati
 * (costituzione §4.4). Disegnato in SVG inline, nessun asset esterno.
 */
export function BrandMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="nathion-grad" x1="0" y1="0" x2="32" y2="32">
          <stop offset="0%" stopColor="#5eead4" />
          <stop offset="100%" stopColor="#8b7cf6" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="3.4" fill="url(#nathion-grad)" />
      <circle cx="6" cy="8" r="2.2" fill="#5eead4" fillOpacity="0.85" />
      <circle cx="26" cy="8" r="2.2" fill="#8b7cf6" fillOpacity="0.85" />
      <circle cx="16" cy="27" r="2.2" fill="#5eead4" fillOpacity="0.6" />
      <path
        d="M14 14.2 7.4 9.4M18 14.2l6.6-4.8M16 19.4V24.6"
        stroke="url(#nathion-grad)"
        strokeWidth="1.1"
        strokeLinecap="round"
        opacity="0.7"
      />
    </svg>
  );
}

export function BrandWordmark({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <BrandMark />
      <span className="font-display text-base font-semibold tracking-tight text-nathion-text">
        NATHION
      </span>
    </div>
  );
}

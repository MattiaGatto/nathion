import { BrandMark } from "./Brand";

const SUGGESTIONS = [
  "Spiegami come funziona il tuo orchestratore",
  "Aiutami a pianificare la mia giornata",
  "Scrivi uno script Python per ordinare una lista",
  "Riassumi in 3 punti un argomento a tua scelta",
];

export function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-nathion-panel shadow-glow ring-1 ring-nathion-border">
        <BrandMark className="h-8 w-8" />
      </div>
      <h2 className="font-display text-xl font-semibold text-nathion-text">
        Ciao, sono NATHION
      </h2>
      <p className="mt-1.5 max-w-sm text-balance text-sm text-nathion-muted">
        La tua intelligenza. Il tuo sistema. Il tuo controllo. Scrivimi qualcosa per iniziare.
      </p>

      <div className="mt-6 grid w-full max-w-md grid-cols-1 gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((text) => (
          <button
            key={text}
            onClick={() => onPick(text)}
            className="rounded-xl border border-nathion-border bg-nathion-panel px-3.5 py-2.5 text-left text-xs text-nathion-muted transition hover:border-nathion-accent-dim/40 hover:text-nathion-text"
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

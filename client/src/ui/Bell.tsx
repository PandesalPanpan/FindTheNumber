interface Props {
  /** the live announcement text (carries the legacy `banner` testid) */
  text: string;
  /** the number to find — shown big; null for the caller / while waiting */
  number: number | null;
  /** searcher has found the number: the bell becomes a slappable target */
  armed: boolean;
  /** true only for the searcher, where the bell is a real action button */
  interactive: boolean;
  onRing: () => void;
}

/**
 * The single status surface, pinned just below the number sheet and always on
 * screen. It announces the current state for both players and, for the
 * searcher, becomes the slap target (a real button) once the number is found.
 * For the caller it is an inert placard.
 */
export function Bell({ text, number, armed, interactive, onRing }: Props) {
  const mode = armed ? 'armed' : interactive ? 'target' : 'inert';

  const inner = (
    <>
      <span className="bell-ico" aria-hidden>🔔</span>
      <span className="bell-body">
        {number !== null && (
          <span className="bell-number" data-testid="find-target">{number}</span>
        )}
        <span className="bell-text" data-testid="banner">{text}</span>
      </span>
    </>
  );

  if (interactive) {
    return (
      <button
        type="button"
        className={`bell ${mode}`}
        data-testid="bell"
        disabled={!armed}
        onClick={onRing}
        aria-label="Ring the bell"
      >
        {inner}
      </button>
    );
  }

  return (
    <div className={`bell ${mode}`} data-testid="bell" aria-live="polite">
      {inner}
    </div>
  );
}

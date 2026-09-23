interface Props {
  /** live guidance for the bell surface */
  text: string;
  /** the number to find — null for the caller / while waiting */
  number: number | null;
  /** searcher has found the number: the bell becomes a slappable target */
  armed: boolean;
  /** true only for the searcher, where the bell is a real action button */
  interactive: boolean;
  /** State-specific accessible name; includes the live target for searchers. */
  ariaLabel: string;
  onRing: () => void;
}

/** The bell remains inert until the searcher has found the called number. */
export function Bell({ text, number, armed, interactive, ariaLabel, onRing }: Props) {
  const mode = armed ? 'armed' : interactive ? 'target' : 'inert';

  const inner = (
    <>
      <span className="bell-ico" aria-hidden="true">🔔</span>
      <span className="bell-body" aria-live={interactive ? 'polite' : undefined} aria-atomic="true">
        {interactive && number !== null && !armed && (
          <>
            <span className="bell-target-kicker">TARGET NUMBER</span>
            <strong className="bell-target-number" data-testid="find-target">{number}</strong>
          </>
        )}
        {armed && number !== null && (
          <span className="bell-target" data-testid="bell-target">TARGET {number} FOUND</span>
        )}
        <span className="bell-text" data-testid="bell-status">{text}</span>
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
        aria-label={ariaLabel}
      >
        {inner}
      </button>
    );
  }

  return (
    <div className={`bell ${mode}`} data-testid="bell" role="status" aria-label={ariaLabel}>
      {inner}
    </div>
  );
}

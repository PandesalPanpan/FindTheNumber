interface Props {
  /** live guidance for the bell surface */
  text: string;
  /** the number to find — null for the caller / while waiting */
  number: number | null;
  /** searcher has found the number: the bell becomes a slappable target */
  armed: boolean;
  /** true only for the searcher, where the bell is a real action button */
  interactive: boolean;
  onRing: () => void;
}

/** The bell remains inert until the searcher has found the called number. */
export function Bell({ text, number, armed, interactive, onRing }: Props) {
  const mode = armed ? 'armed' : interactive ? 'target' : 'inert';
  const accessibleName = armed && number !== null
    ? `Target ${number} found. Slap the bell now.`
    : interactive
      ? 'Bell locked until you find the target number'
      : 'Bell is waiting for the number to be found';

  const inner = (
    <>
      <span className="bell-ico" aria-hidden="true">🔔</span>
      <span className="bell-body">
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
        aria-label={accessibleName}
        aria-live="polite"
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

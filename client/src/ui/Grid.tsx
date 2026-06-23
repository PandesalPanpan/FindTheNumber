interface Props {
  size: number; // NxN
  filled: number; // committed count (drives the n/total label)
  label: string;
  mine: boolean;
  /** which boxes are X'd in (own grid only; opponent renders row-major by count) */
  cells?: Set<number>;
  /** box index currently inking in, or null */
  holdingCell?: number | null;
  /** ink progress [0,1] of the held cell */
  holdFraction?: number;
  /** the caller may press-and-hold individual boxes right now */
  canFill?: boolean;
  onCellDown?: (index: number) => void;
  onCellUp?: () => void;
}

/**
 * A player's grid. On your own grid you press-and-hold an individual empty box;
 * it inks in over the fill rate and commits when full (the hold locks to the
 * cell it started on, so finger drift won't cancel it). Lifting early discards
 * the partial box. The opponent's grid is just a row-major progress fill.
 */
export function Grid({
  size,
  filled,
  label,
  mine,
  cells,
  holdingCell,
  holdFraction,
  canFill,
  onCellDown,
  onCellUp,
}: Props) {
  const total = size * size;
  const frac = Math.min(1, Math.max(0, holdFraction ?? 0));

  const down = (i: number) => (e: React.PointerEvent) => {
    if (!canFill || !mine) return;
    if (cells?.has(i)) return;
    e.preventDefault();
    onCellDown?.(i);
    try {
      // lock the hold to this cell so drifting onto a neighbor can't cancel it
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      /* capture is best-effort */
    }
  };
  const up = () => {
    if (!canFill || !mine) return;
    onCellUp?.();
  };

  return (
    <div className={`grid-wrap${mine ? ' mine' : ''}`}>
      <div className="grid-label">
        <span>{label}</span>
        <span className="grid-count">
          {filled}<span className="grid-count-total">/{total}</span>
        </span>
      </div>
      <div
        className={`grid${mine && canFill ? ' holdable' : ''}`}
        data-testid={mine ? 'my-grid' : 'opp-grid'}
        style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}
      >
        {Array.from({ length: total }, (_, i) => {
          const isFull = mine ? !!cells?.has(i) : i < filled;
          const isInking = mine && !isFull && holdingCell === i && frac > 0.02;
          return (
            <div
              key={i}
              className={`box${isFull ? ' x' : ''}${isInking ? ' filling' : ''}`}
              data-testid={mine ? `my-box-${i}` : undefined}
              onPointerDown={mine ? down(i) : undefined}
              onPointerUp={mine ? up : undefined}
              onPointerCancel={mine ? up : undefined}
            >
              {isFull && <span className="mark">✗</span>}
              {isInking && (
                <span className="mark grow" style={{ ['--p' as string]: String(frac) } as React.CSSProperties}>
                  ✗
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

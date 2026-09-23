import { useEffect, useRef, useState } from 'react';

interface Props {
  size: number; // NxN
  filled: number; // committed count (drives the n/total label)
  label: string;
  mine: boolean;
  /** which boxes are X'd in on this player's own grid */
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
 * The player's own grid. Pointer capture keeps a hold attached to its starting
 * cell; keyboard users can hold Space on a focused cell for the same fair fill.
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
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const [focusIndex, setFocusIndex] = useState(0);

  useEffect(() => {
    if (!mine || !cells?.has(focusIndex)) return;
    const next = Array.from({ length: total }, (_, i) => i).find((i) => !cells.has(i));
    if (next !== undefined) setFocusIndex(next);
  }, [cells, filled, focusIndex, mine, total]);

  const down = (i: number) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!canFill || !mine || cells?.has(i)) return;
    e.preventDefault();
    onCellDown?.(i);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* pointer capture is best-effort */
    }
  };

  const up = () => onCellUp?.();

  const keyDown = (i: number) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      const row = Math.floor(i / size);
      const col = i % size;
      const nextRow = e.key === 'ArrowUp' ? Math.max(0, row - 1)
        : e.key === 'ArrowDown' ? Math.min(size - 1, row + 1) : row;
      const nextCol = e.key === 'ArrowLeft' ? Math.max(0, col - 1)
        : e.key === 'ArrowRight' ? Math.min(size - 1, col + 1) : col;
      const next = nextRow * size + nextCol;
      setFocusIndex(next);
      buttons.current[next]?.focus();
      return;
    }

    if ((e.key === ' ' || e.key === 'Enter') && canFill && !cells?.has(i)) {
      e.preventDefault();
      if (!e.repeat) onCellDown?.(i);
    }
  };

  const keyUp = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      up();
    }
  };

  return (
    <section className={`grid-wrap${mine ? ' mine' : ''}`} aria-label={`${label} progress`}>
      <div className="grid-label">
        <span>{label}</span>
        <span className="grid-count" data-testid="player-count">
          {filled}<span className="grid-count-total">/{total}</span>
        </span>
      </div>
      <p id="grid-help" className="visually-hidden">
        {canFill ? 'Press and hold a box, or hold Space on a focused box, to fill it.' : 'Boxes fill during your calling turn.'}
      </p>
      <div
        className={`grid${mine && canFill ? ' holdable' : ''}`}
        data-testid={mine ? 'my-grid' : 'opp-grid'}
        role="grid"
        aria-label={`${label}, ${filled} of ${total} boxes filled`}
        aria-describedby="grid-help"
        aria-rowcount={size}
        aria-colcount={size}
        style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: total }, (_, i) => {
          const isFull = mine ? !!cells?.has(i) : i < filled;
          const isInking = mine && !isFull && holdingCell === i && frac > 0.02;
          const cellLabel = `Box ${i + 1} of ${total}, ${isFull ? 'filled' : isInking ? 'filling' : 'empty'}`;
          return (
            <button
              key={i}
              ref={(element) => { buttons.current[i] = element; }}
              type="button"
              className={`box${isFull ? ' x' : ''}${isInking ? ' filling' : ''}`}
              data-testid={mine ? `my-box-${i}` : undefined}
              aria-label={cellLabel}
              aria-disabled={!canFill || isFull}
              aria-pressed={isFull}
              tabIndex={mine && i === focusIndex ? 0 : -1}
              onFocus={() => setFocusIndex(i)}
              onPointerDown={mine ? down(i) : undefined}
              onPointerUp={mine ? up : undefined}
              onPointerCancel={mine ? up : undefined}
              onLostPointerCapture={mine ? up : undefined}
              onKeyDown={mine ? keyDown(i) : undefined}
              onKeyUp={mine ? keyUp : undefined}
            >
              {isFull && <span className="mark" aria-hidden="true">×</span>}
              {isInking && (
                <span className="mark grow" aria-hidden="true" style={{ ['--p' as string]: String(frac) } as React.CSSProperties}>
                  ×
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

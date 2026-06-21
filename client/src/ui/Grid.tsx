import { useState } from 'react';

interface Props {
  size: number; // NxN
  filled: number; // committed count (drives the n/total label)
  /** exact fractional fill (>= filled) so the next box can ink-in live */
  fillExact?: number;
  label: string;
  mine: boolean;
  /** hold-to-fill handlers (only wired for the caller's own grid) */
  onHoldStart?: () => void;
  onHoldEnd?: () => void;
  holdable?: boolean;
}

/**
 * A player's grid. The first `full` boxes (row-major) show a hand-drawn X; the
 * next box inks in proportionally to `fillExact` so the caller sees scribbling
 * happen in real time. The owning caller can press-and-hold to auto-fill.
 */
export function Grid({
  size,
  filled,
  fillExact,
  label,
  mine,
  onHoldStart,
  onHoldEnd,
  holdable,
}: Props) {
  const total = size * size;
  const exact = Math.min(total, fillExact ?? filled);
  const full = Math.floor(exact + 1e-6);
  const frac = Math.min(1, Math.max(0, exact - full));
  const [held, setHeld] = useState(false);

  const start = (e: React.PointerEvent) => {
    if (!holdable) return;
    e.preventDefault();
    setHeld(true);
    onHoldStart?.();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      /* capture is best-effort */
    }
  };
  const end = () => {
    if (!holdable) return;
    setHeld(false);
    onHoldEnd?.();
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
        className={`grid${holdable ? ' holdable' : ''}${held && holdable ? ' held' : ''}`}
        data-testid={mine ? 'my-grid' : 'opp-grid'}
        style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}
        onPointerDown={start}
        onPointerUp={end}
        onPointerLeave={end}
        onPointerCancel={end}
      >
        {Array.from({ length: total }, (_, i) => {
          const isFull = i < full;
          const isFilling = i === full && frac > 0.02 && i < total;
          return (
            <div
              key={i}
              className={`box${isFull ? ' x' : ''}${isFilling ? ' filling' : ''}`}
              data-testid={mine ? `my-box-${i}` : undefined}
            >
              {isFull && <span className="mark">✗</span>}
              {isFilling && (
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

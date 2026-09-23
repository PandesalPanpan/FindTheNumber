import { useEffect, useRef, useState } from 'react';
import rough from 'roughjs';
import { Sheet as SheetModel } from '@ftn/shared';

type PickResult = 'wrong' | 'correct' | 'ignored';

interface Props {
  sheet: SheetModel;
  /** searcher may click numbers to find; caller clicks to call */
  onPick: (value: number) => PickResult;
  /** caller mode shows un-circled numbers as callable; searcher hunts */
  interactive: boolean;
  /** Clears number feedback when the active turn changes, even if the value repeats. */
  feedbackScope: number | null;
  /** Correct target found locally; draw its circle before the bell event settles. */
  previewCircledValue: number | null;
}

interface FindFeedback {
  value: number;
  result: Exclude<PickResult, 'ignored'>;
  scope: number | null;
  nonce: number;
}

const HAND_FONTS = [
  'Caveat, cursive',
  'Patrick Hand, cursive',
  'Schoolbell, cursive',
  'Gloria Hallelujah, cursive',
  'Rock Salt, cursive',
  'Permanent Marker, cursive',
] as const;

/** Stable per sheet and number: both peers render the same handwriting treatment. */
function visualHash(seed: number, id: number, value: number): number {
  const key = `${seed}:${id}:${value}`;
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Keep each number in its already-assigned shuffled cell, with restrained
 * deterministic jitter so handwritten glyphs remain distinct on the paper. */
function visualPosition(sheet: SheetModel, n: SheetModel['numbers'][number]) {
  const count = Math.max(1, sheet.numbers.length);
  const columns = Math.ceil(Math.sqrt(count * 1.4));
  const rows = Math.ceil(count / columns);
  const margin = 0.06;
  const usable = 1 - margin * 2;
  const cellWidth = usable / columns;
  const cellHeight = usable / rows;
  const column = Math.min(columns - 1, Math.max(0, Math.floor((n.x - margin) / cellWidth)));
  const row = Math.min(rows - 1, Math.max(0, Math.floor((n.y - margin) / cellHeight)));
  const cellCenterX = margin + (column + 0.5) * cellWidth;
  const cellCenterY = margin + (row + 0.5) * cellHeight;

  return {
    x: cellCenterX + (n.x - cellCenterX) * 0.5,
    y: cellCenterY + (n.y - cellCenterY) * 0.5,
  };
}

/**
 * The shared paper keeps mirrored spatial placement while each glyph is
 * presented upside down. Found numbers receive a hand-drawn rough.js circle.
 */
export function Sheet({ sheet, onPick, interactive, feedbackScope, previewCircledValue }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const sequence = useRef(0);
  const feedbackTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const pressTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const [feedback, setFeedback] = useState<FindFeedback | null>(null);
  const [pressedValue, setPressedValue] = useState<number | null>(null);

  const clearTimer = (timer: { current: ReturnType<typeof window.setTimeout> | null }) => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const resolveNumberAt = (container: HTMLDivElement, x: number, y: number) => {
    const numbers = container.querySelectorAll<HTMLButtonElement>('.sheet-num');
    let closest: HTMLButtonElement | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const button of numbers) {
      const bounds = button.getBoundingClientRect();
      const distance = Math.hypot(
        x - (bounds.left + bounds.width / 2),
        y - (bounds.top + bounds.height / 2),
      );
      if (distance < closestDistance) {
        closest = button;
        closestDistance = distance;
      }
    }

    if (!closest || closest.disabled) return null;
    const bounds = closest.getBoundingClientRect();
    const hitRadius = Math.max(32, Math.min(44, Math.max(bounds.width, bounds.height) * 0.9));
    return closestDistance <= hitRadius ? closest : null;
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive || event.button !== 0) return;
    const target = resolveNumberAt(event.currentTarget, event.clientX, event.clientY);
    if (target) setPressedValue(Number(target.dataset.value));
  };

  const handlePointerRelease = () => {
    clearTimer(pressTimer);
    setPressedValue(null);
  };

  const pick = (value: number) => {
    const result = onPick(value);
    if (result === 'ignored') return;

    clearTimer(feedbackTimer);
    const nonce = ++sequence.current;
    setFeedback({ value, result, scope: feedbackScope, nonce });
    feedbackTimer.current = window.setTimeout(() => {
      setFeedback((current) => current?.nonce === nonce ? null : current);
      feedbackTimer.current = null;
    }, result === 'wrong' ? 190 : 320);
  };

  useEffect(() => {
    clearTimer(feedbackTimer);
    clearTimer(pressTimer);
    setFeedback(null);
    setPressedValue(null);
  }, [feedbackScope, sheet.seed]);

  useEffect(() => () => {
    clearTimer(feedbackTimer);
    clearTimer(pressTimer);
  }, []);

  const handleSheetClick = (event: React.MouseEvent<HTMLDivElement>) => {
    // The spacious invisible touch targets can overlap on a dense sheet. Resolve
    // pointer taps to the nearest printed number instead of whichever button
    // happens to be painted on top. Keyboard activation still uses its focused
    // button directly.
    if (event.detail === 0 && event.target instanceof Element) {
      const focused = event.target.closest<HTMLButtonElement>('.sheet-num');
      if (focused && !focused.disabled) {
        const value = Number(focused.dataset.value);
        setPressedValue(value);
        clearTimer(pressTimer);
        pressTimer.current = window.setTimeout(() => {
          setPressedValue((current) => current === value ? null : current);
          pressTimer.current = null;
        }, 90);
        pick(value);
      }
      return;
    }

    const closest = resolveNumberAt(event.currentTarget, event.clientX, event.clientY);
    if (closest) pick(Number(closest.dataset.value));
  };

  const visibleFeedback = feedback?.scope === feedbackScope ? feedback : null;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.innerHTML = '';
    const rc = rough.svg(svg);
    const width = 1000;
    const height = 500;
    for (const n of sheet.numbers) {
      if (!n.circled && n.value !== previewCircledValue) continue;
      const position = visualPosition(sheet, n);
      const revealing = !n.circled && n.value === previewCircledValue;
      const node = rc.ellipse(position.x * width, position.y * height, 132, 104, {
        stroke: '#c83f36',
        strokeWidth: 3,
        roughness: 2.2,
        seed: n.id + 1,
      });
      if (revealing) {
        node.classList.add('target-circle-reveal');
        for (const path of node.querySelectorAll<SVGPathElement>('path')) {
          path.setAttribute('pathLength', '1');
        }
      }
      svg.appendChild(node);
    }
  }, [sheet, previewCircledValue]);

  return (
    <div className="sheet" data-testid="sheet" role="group" aria-label="Shared upside-down number sheet">
      <div
        className="sheet-flip"
        onClick={handleSheetClick}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerRelease}
        onPointerCancel={handlePointerRelease}
      >
        <svg
          ref={svgRef}
          className="sheet-circles"
          viewBox="0 0 1000 500"
          preserveAspectRatio="none"
          aria-hidden="true"
        />
        {sheet.numbers.map((n) => {
          const hash = visualHash(sheet.seed, n.id, n.value);
          const position = visualPosition(sheet, n);
          const visuallyCircled = n.circled || n.value === previewCircledValue;
          const numberFeedback = visibleFeedback?.value === n.value ? visibleFeedback : null;
          const rotation = 180 + Math.max(-7, Math.min(7, Math.round(n.rot * 0.4)));
          const fontWeight = [400, 500, 600, 700][(hash >>> 5) % 4];
          const fontSize = 20 + ((hash >>> 9) % 7);
          const letterSpacing = (((hash >>> 13) % 7) - 3) * 0.01;
          return (
            <button
              key={n.id}
              type="button"
              className={`sheet-num${visuallyCircled ? ' circled' : ''}${pressedValue === n.value ? ' is-pressed' : ''}${numberFeedback ? ` feedback-${numberFeedback.result}` : ''}`}
              data-value={n.value}
              data-testid={`num-${n.value}`}
              data-feedback={numberFeedback?.result}
              data-feedback-seq={numberFeedback?.nonce}
              data-hand-font={['caveat', 'patrick', 'schoolbell', 'gloria', 'rock', 'marker'][hash % HAND_FONTS.length]}
              disabled={n.circled || !interactive}
              aria-label={`Number ${n.value}${visuallyCircled ? ', found' : ''}`}
              style={{
                left: `${position.x * 100}%`,
                top: `${position.y * 100}%`,
                transform: `translate(-50%, -50%) scaleX(-1) rotate(${rotation}deg)`,
                fontFamily: HAND_FONTS[hash % HAND_FONTS.length],
                fontSize: `clamp(18px, ${(fontSize / 3.9).toFixed(2)}vw, ${fontSize}px)`,
                fontWeight,
                letterSpacing: `${letterSpacing}em`,
              }}
            >
              <span key={numberFeedback?.nonce ?? 'idle'} className="sheet-glyph">
                {n.value}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

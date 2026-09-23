import { useEffect, useRef } from 'react';
import rough from 'roughjs';
import { Sheet as SheetModel } from '@ftn/shared';

interface Props {
  sheet: SheetModel;
  /** searcher may click numbers to find; caller clicks to call */
  onPick: (value: number) => void;
  /** caller mode shows un-circled numbers as callable; searcher hunts */
  interactive: boolean;
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

/**
 * The shared paper keeps mirrored spatial placement while each glyph is
 * presented upside down. Found numbers receive a hand-drawn rough.js circle.
 */
export function Sheet({ sheet, onPick, interactive }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.innerHTML = '';
    const rc = rough.svg(svg);
    const width = 1000;
    const height = 500;
    for (const n of sheet.numbers) {
      if (!n.circled) continue;
      const node = rc.ellipse(n.x * width, n.y * height, 112, 84, {
        stroke: '#c83f36',
        strokeWidth: 3,
        roughness: 2.2,
        seed: n.id + 1,
      });
      svg.appendChild(node);
    }
  }, [sheet]);

  return (
    <div className="sheet" data-testid="sheet" aria-label="Shared upside-down number sheet">
      <div className="sheet-flip">
        <svg
          ref={svgRef}
          className="sheet-circles"
          viewBox="0 0 1000 500"
          preserveAspectRatio="none"
          aria-hidden="true"
        />
        {sheet.numbers.map((n) => {
          const hash = visualHash(sheet.seed, n.id, n.value);
          const rotation = 180 + Math.max(-7, Math.min(7, Math.round(n.rot * 0.4)));
          const fontWeight = [400, 500, 600, 700][(hash >>> 5) % 4];
          const fontSize = 27 + ((hash >>> 9) % 9);
          const letterSpacing = (((hash >>> 13) % 7) - 3) * 0.01;
          return (
            <button
              key={n.id}
              type="button"
              className={`sheet-num${n.circled ? ' circled' : ''}`}
              data-value={n.value}
              data-testid={`num-${n.value}`}
              data-hand-font={['caveat', 'patrick', 'schoolbell', 'gloria', 'rock', 'marker'][hash % HAND_FONTS.length]}
              disabled={n.circled || !interactive}
              aria-label={`Number ${n.value}${n.circled ? ', already found' : ''}`}
              onClick={() => onPick(n.value)}
              style={{
                left: `${n.x * 100}%`,
                top: `${n.y * 100}%`,
                transform: `translate(-50%, -50%) scaleX(-1) rotate(${rotation}deg)`,
                fontFamily: HAND_FONTS[hash % HAND_FONTS.length],
                fontSize: `${fontSize}px`,
                fontWeight,
                letterSpacing: `${letterSpacing}em`,
              }}
            >
              {n.value}
            </button>
          );
        })}
      </div>
    </div>
  );
}

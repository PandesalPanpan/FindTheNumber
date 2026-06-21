import { useEffect, useRef } from 'react';
import rough from 'roughjs';
import { Sheet as SheetModel } from '@ftn/shared';

interface Props {
  sheet: SheetModel;
  /** searcher may click numbers to find; caller clicks to call */
  onPick: (value: number) => void;
  /** caller mode shows un-circled numbers as callable; searcher hunts */
  interactive: boolean;
  /** brief wrong-click feedback target value */
  shakeNonce?: number;
}

/**
 * The shared mirrored "paper". Numbers are handwritten (Caveat) and the whole
 * sheet is flipped horizontally (scaleX(-1)) so digits read backwards. Found
 * numbers get a hand-drawn rough.js circle.
 */
export function Sheet({ sheet, onPick, interactive }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  // draw hand-drawn circles over circled numbers
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.innerHTML = '';
    const rc = rough.svg(svg);
    const W = 1000;
    const H = 1000;
    for (const n of sheet.numbers) {
      if (!n.circled) continue;
      const cx = n.x * W;
      const cy = n.y * H;
      const node = rc.ellipse(cx, cy, 90, 70, {
        stroke: '#c0392b',
        strokeWidth: 3,
        roughness: 2.2,
        seed: n.id + 1,
      });
      svg.appendChild(node);
    }
  }, [sheet]);

  return (
    <div className="sheet" data-testid="sheet">
      <div className="sheet-flip">
        <svg ref={svgRef} className="sheet-circles" viewBox="0 0 1000 1000" preserveAspectRatio="none" />
        {sheet.numbers.map((n) => (
          <button
            key={n.id}
            type="button"
            className={`sheet-num${n.circled ? ' circled' : ''}`}
            data-value={n.value}
            data-testid={`num-${n.value}`}
            disabled={n.circled || !interactive}
            onClick={() => onPick(n.value)}
            style={{
              left: `${n.x * 100}%`,
              top: `${n.y * 100}%`,
              transform: `translate(-50%, -50%) rotate(${n.rot}deg)`,
            }}
          >
            {n.value}
          </button>
        ))}
      </div>
    </div>
  );
}

import { GameConfig, Sheet, SheetNumber } from './types.js';
import { mulberry32, intIn } from './rng.js';

/**
 * Deterministically generate a sheet of unique numbers scattered across the
 * paper. Same seed + config => identical sheet on every peer.
 *
 * Positions are normalized [0,1]. We place on a jittered grid so numbers do not
 * overlap, then shuffle which cell each number lands in.
 */
export function generateSheet(seed: number, config: GameConfig): Sheet {
  const rng = mulberry32(seed);
  const { sheetCount, numberMin, numberMax } = config;

  const span = numberMax - numberMin + 1;
  if (sheetCount > span) {
    throw new Error(
      `sheetCount ${sheetCount} exceeds available numbers ${span}`,
    );
  }

  // pick `sheetCount` unique values
  const pool: number[] = [];
  for (let v = numberMin; v <= numberMax; v++) pool.push(v);
  // Fisher-Yates partial shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const values = pool.slice(0, sheetCount);

  // layout on a jittered grid that comfortably holds sheetCount cells
  const cols = Math.ceil(Math.sqrt(sheetCount * 1.4));
  const rows = Math.ceil(sheetCount / cols);
  const cells: number[] = [];
  for (let i = 0; i < cols * rows; i++) cells.push(i);
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }

  const margin = 0.06;
  const usable = 1 - margin * 2;
  const cellW = usable / cols;
  const cellH = usable / rows;

  const numbers: SheetNumber[] = values.map((value, idx) => {
    const cell = cells[idx];
    const c = cell % cols;
    const r = Math.floor(cell / cols);
    // jitter within the cell but keep a pad so glyphs don't collide
    const padX = cellW * 0.18;
    const padY = cellH * 0.18;
    const x = margin + c * cellW + padX + rng() * (cellW - 2 * padX);
    const y = margin + r * cellH + padY + rng() * (cellH - 2 * padY);
    const rot = intIn(rng, -18, 18);
    return { id: idx, value, x, y, rot, circled: false };
  });

  return { seed, numbers };
}

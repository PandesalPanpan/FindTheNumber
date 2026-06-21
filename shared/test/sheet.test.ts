import { describe, it, expect } from 'vitest';
import { generateSheet } from '../src/sheet.js';
import { DEFAULT_CONFIG } from '../src/types.js';

describe('generateSheet', () => {
  it('is deterministic for the same seed', () => {
    const a = generateSheet(42, DEFAULT_CONFIG);
    const b = generateSheet(42, DEFAULT_CONFIG);
    expect(a).toEqual(b);
  });

  it('differs across seeds', () => {
    const a = generateSheet(1, DEFAULT_CONFIG);
    const b = generateSheet(2, DEFAULT_CONFIG);
    expect(a.numbers).not.toEqual(b.numbers);
  });

  it('honors count and uniqueness', () => {
    const s = generateSheet(7, DEFAULT_CONFIG);
    expect(s.numbers).toHaveLength(DEFAULT_CONFIG.sheetCount);
    const values = new Set(s.numbers.map((n) => n.value));
    expect(values.size).toBe(DEFAULT_CONFIG.sheetCount);
  });

  it('keeps positions within bounds', () => {
    const s = generateSheet(99, DEFAULT_CONFIG);
    for (const n of s.numbers) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(1);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeLessThanOrEqual(1);
    }
  });

  it('throws when count exceeds the value range', () => {
    expect(() =>
      generateSheet(1, { ...DEFAULT_CONFIG, numberMin: 1, numberMax: 10, sheetCount: 30 }),
    ).toThrow();
  });
});

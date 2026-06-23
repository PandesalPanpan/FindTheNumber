import { describe, it, expect } from 'vitest';
import { applyEvent, needsNewSheet, other } from '../src/engine.js';
import { generateSheet } from '../src/sheet.js';
import { DEFAULT_CONFIG, GameState, Sheet } from '../src/types.js';

function start(config = DEFAULT_CONFIG): GameState {
  const sheet = generateSheet(1, config);
  return applyEvent({} as GameState, {
    type: 'START',
    firstCaller: 'host',
    sheet,
    config,
  });
}

/** Bank `n` cells honestly: each completes exactly one fillRate after the last. */
function fillCells(s: GameState, n: number): GameState {
  const rate = s.config.fillRateMs;
  const callTime = s.callTime ?? 0;
  for (let k = 1; k <= n; k++) {
    s = applyEvent(s, { type: 'CELL_FILL', t: callTime + k * rate });
  }
  return s;
}

describe('engine', () => {
  it('banks one box per fully-held cell and circles the number on BELL', () => {
    let s = start();
    const num = s.sheet.numbers[0].value;
    s = applyEvent(s, { type: 'CALL', number: num, callTime: 1000 });
    expect(s.activeNumber).toBe(num);
    s = fillCells(s, 5); // five completed cell-holds
    expect(s.filled.host).toBe(5);
    expect(s.filled.guest).toBe(0);
    s = applyEvent(s, { type: 'BELL', bellTime: 1000 + 2000 });
    expect(s.caller).toBe('guest'); // alternation
    expect(s.sheet.numbers.find((n) => n.value === num)!.circled).toBe(true);
  });

  it('rejects banking a box faster than the elapsed time budget allows', () => {
    let s = start({ ...DEFAULT_CONFIG, fillRateMs: 400 });
    const num = s.sheet.numbers[0].value;
    s = applyEvent(s, { type: 'CALL', number: num, callTime: 0 });
    // 200ms in, budget = floor(200/400) = 0 -> reject
    s = applyEvent(s, { type: 'CELL_FILL', t: 200 });
    expect(s.filled.host).toBe(0);
    expect(s.roundFilled).toBe(0);
    // 400ms in, budget = 1 -> accept
    s = applyEvent(s, { type: 'CELL_FILL', t: 400 });
    expect(s.filled.host).toBe(1);
    expect(s.roundFilled).toBe(1);
  });

  it('resets the round budget on each new CALL', () => {
    let s = start({ ...DEFAULT_CONFIG, fillRateMs: 400 });
    const v0 = s.sheet.numbers[0].value;
    s = applyEvent(s, { type: 'CALL', number: v0, callTime: 0 });
    s = fillCells(s, 3);
    s = applyEvent(s, { type: 'BELL', bellTime: 5000 });
    expect(s.roundFilled).toBe(0); // reset after the round ends
    // guest is now caller; their round starts fresh
    const v1 = s.sheet.numbers.find((n) => !n.circled)!.value;
    s = applyEvent(s, { type: 'CALL', number: v1, callTime: 10000 });
    s = applyEvent(s, { type: 'CELL_FILL', t: 10200 }); // 200ms -> budget 0, reject
    expect(s.filled.guest).toBe(0);
    s = applyEvent(s, { type: 'CELL_FILL', t: 10400 }); // budget 1, accept
    expect(s.filled.guest).toBe(1);
  });

  it('rejects calling a circled or absent number', () => {
    let s = start();
    const num = s.sheet.numbers[0].value;
    s = applyEvent(s, { type: 'CALL', number: num, callTime: 0 });
    s = applyEvent(s, { type: 'BELL', bellTime: 400 });
    // now host->guest is caller; try to recall the circled number
    const before = s;
    s = applyEvent(s, { type: 'CALL', number: num, callTime: 1000 });
    expect(s.activeNumber).toBe(null);
    expect(s).toEqual(before);
    // absent number
    s = applyEvent(s, { type: 'CALL', number: 99999, callTime: 1000 });
    expect(s.activeNumber).toBe(null);
  });

  it('accumulates across rounds and triggers instant win at cap', () => {
    const config = { ...DEFAULT_CONFIG, fillRateMs: 100 };
    let s = start(config);
    const num = s.sheet.numbers[0].value;
    s = applyEvent(s, { type: 'CALL', number: num, callTime: 0 });
    s = fillCells(s, 100); // fills the whole grid mid-search
    expect(s.filled.host).toBe(100);
    expect(s.phase).toBe('over');
    expect(s.winner).toBe('host');
  });

  it('caps boxes at the grid total (never overfills)', () => {
    const config = { ...DEFAULT_CONFIG, fillRateMs: 1 };
    let s = start(config);
    const num = s.sheet.numbers[0].value;
    s = applyEvent(s, { type: 'CALL', number: num, callTime: 0 });
    // try to bank way more than the grid holds; budget is generous (rate=1)
    for (let k = 1; k <= 150; k++) {
      s = applyEvent(s, { type: 'CELL_FILL', t: k });
    }
    expect(s.filled.host).toBe(100);
    expect(s.phase).toBe('over');
  });

  it('flags needsNewSheet only when all circled', () => {
    let s = start({ ...DEFAULT_CONFIG, sheetCount: 2, numberMin: 1, numberMax: 9 });
    expect(needsNewSheet(s)).toBe(false);
    // circle both numbers via two rounds (no fills so no win)
    const v0 = s.sheet.numbers[0].value;
    s = applyEvent(s, { type: 'CALL', number: v0, callTime: 0 });
    s = applyEvent(s, { type: 'BELL', bellTime: 10 });
    const v1 = s.sheet.numbers.find((n) => !n.circled)!.value;
    s = applyEvent(s, { type: 'CALL', number: v1, callTime: 0 });
    s = applyEvent(s, { type: 'BELL', bellTime: 10 });
    expect(needsNewSheet(s)).toBe(true);

    const fresh: Sheet = generateSheet(2, s.config);
    s = applyEvent(s, { type: 'NEW_SHEET', sheet: fresh });
    expect(needsNewSheet(s)).toBe(false);
  });

  it('other() flips roles', () => {
    expect(other('host')).toBe('guest');
    expect(other('guest')).toBe('host');
  });
});

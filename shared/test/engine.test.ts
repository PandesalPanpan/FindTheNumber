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

describe('engine', () => {
  it('awards floor(heldTime/rate) boxes to the caller on BELL', () => {
    let s = start();
    const num = s.sheet.numbers[0].value;
    s = applyEvent(s, { type: 'CALL', number: num, callTime: 1000 });
    expect(s.activeNumber).toBe(num);
    s = applyEvent(s, { type: 'HOLD_START', tStart: 1000 });
    s = applyEvent(s, { type: 'BELL', bellTime: 1000 + 2000 }); // 2000ms / 400 = 5
    expect(s.filled.host).toBe(5);
    expect(s.filled.guest).toBe(0);
    expect(s.caller).toBe('guest'); // alternation
    // number is circled
    expect(s.sheet.numbers.find((n) => n.value === num)!.circled).toBe(true);
  });

  it('only counts time while holding (pausing on release)', () => {
    let s = start();
    const num = s.sheet.numbers[0].value;
    s = applyEvent(s, { type: 'CALL', number: num, callTime: 0 });
    s = applyEvent(s, { type: 'HOLD_START', tStart: 0 });
    s = applyEvent(s, { type: 'HOLD_END', tEnd: 800 }); // 2 boxes held
    // idle 5s (no hold) -> no boxes accrue
    s = applyEvent(s, { type: 'HOLD_START', tStart: 5800 });
    s = applyEvent(s, { type: 'BELL', bellTime: 6200 }); // +400ms = +1 box
    expect(s.filled.host).toBe(3);
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
    // host earns 100 in one giant round -> instant win
    const num = s.sheet.numbers[0].value;
    s = applyEvent(s, { type: 'CALL', number: num, callTime: 0 });
    s = applyEvent(s, { type: 'HOLD_START', tStart: 0 });
    s = applyEvent(s, { type: 'BELL', bellTime: 100 * 100 }); // 100 boxes
    expect(s.filled.host).toBe(100);
    expect(s.phase).toBe('over');
    expect(s.winner).toBe('host');
  });

  it('caps boxes at the grid total', () => {
    const config = { ...DEFAULT_CONFIG, fillRateMs: 1 };
    let s = start(config);
    const num = s.sheet.numbers[0].value;
    s = applyEvent(s, { type: 'CALL', number: num, callTime: 0 });
    s = applyEvent(s, { type: 'HOLD_START', tStart: 0 });
    s = applyEvent(s, { type: 'BELL', bellTime: 999999 });
    expect(s.filled.host).toBe(100);
  });

  it('flags needsNewSheet only when all circled', () => {
    let s = start({ ...DEFAULT_CONFIG, sheetCount: 2, numberMin: 1, numberMax: 9 });
    expect(needsNewSheet(s)).toBe(false);
    // circle both numbers via two rounds (small durations so no win)
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

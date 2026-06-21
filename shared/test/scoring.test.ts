import { describe, it, expect } from 'vitest';
import { boxesForDuration, bestOffset, toHostTime, ClockSample } from '../src/scoring.js';

describe('boxesForDuration', () => {
  const rate = 400;
  it('is zero for non-positive durations', () => {
    expect(boxesForDuration(0, rate)).toBe(0);
    expect(boxesForDuration(-100, rate)).toBe(0);
  });
  it('floors to whole boxes', () => {
    expect(boxesForDuration(399, rate)).toBe(0);
    expect(boxesForDuration(400, rate)).toBe(1);
    expect(boxesForDuration(799, rate)).toBe(1);
    expect(boxesForDuration(800, rate)).toBe(2);
    expect(boxesForDuration(4000, rate)).toBe(10);
  });
  it('latency bias under one box for typical RTT', () => {
    // a 200ms measurement error never changes the box count by more than 1
    const clean = boxesForDuration(2000, rate);
    const biased = boxesForDuration(2000 + 200, rate);
    expect(Math.abs(biased - clean)).toBeLessThanOrEqual(1);
  });
});

describe('clock offset', () => {
  it('picks the lowest-RTT sample and converts to host time', () => {
    // true host = client + 1000ms offset
    const samples: ClockSample[] = [
      { tSent: 0, tHost: 1005, tRecv: 30 }, // rtt 30, offset est ~ 1005-15=990
      { tSent: 100, tHost: 1102, tRecv: 104 }, // rtt 4, offset est ~ 1102-102=1000
      { tSent: 200, tHost: 1260, tRecv: 320 }, // rtt 120, noisy
    ];
    const offset = bestOffset(samples);
    expect(offset).toBeCloseTo(1000, 0);
    expect(toHostTime(500, offset)).toBeCloseTo(1500, 0);
  });
  it('returns 0 offset with no samples', () => {
    expect(bestOffset([])).toBe(0);
  });
});

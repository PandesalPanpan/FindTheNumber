import { describe, it, expect } from 'vitest';
import { applyEvent } from '../src/engine.js';
import { generateSheet } from '../src/sheet.js';
import { bestOffset, toHostTime, ClockSample } from '../src/scoring.js';
import { mulberry32 } from '../src/rng.js';
import { DEFAULT_CONFIG, GameState, Role } from '../src/types.js';

/**
 * Models a network so we can drive the REAL clock-sync (`bestOffset`) and the
 * REAL engine, then measure how unfair the box award is under latency.
 *
 * Clock model: guest clock reads `trueOffset` ms ahead of the host clock.
 * A ping sent at guest-time tSent is stamped by the host at
 *   tHost = tSent - trueOffset + Lup
 * and the pong arrives back at guest-time
 *   tRecv = tSent + Lup + Ldown
 */
type LatFn = () => [up: number, down: number];

function symmetric(rng: () => number, base: number, jitter: number): LatFn {
  return () => [base + rng() * jitter, base + rng() * jitter];
}
function asymmetric(rng: () => number, up: number, down: number, jitter: number): LatFn {
  return () => [up + rng() * jitter, down + rng() * jitter];
}

function estimateOffset(trueOffset: number, lat: LatFn, rounds = 12): number {
  const samples: ClockSample[] = [];
  let tSent = 500_000;
  for (let i = 0; i < rounds; i++) {
    const [up, down] = lat();
    samples.push({ tSent, tHost: tSent - trueOffset + up, tRecv: tSent + up + down });
    tSent += 200;
  }
  return bestOffset(samples);
}

/**
 * Play one round through the real engine. The caller fills cells one per
 * `rate` on its own clock; the searcher rings the bell after `heldMs`. The
 * call→bell interval always spans the two clocks: the caller's per-cell
 * timestamps are native on its own clock and the searcher's bell is converted
 * to host time with `estOffset` (or vice-versa). Returns the boxes banked.
 *
 * Boxes = cells whose completion lands at/before the bell, host-time. The
 * host's budget cap accepts each of those (it only ever rejects cells faster
 * than the elapsed budget), so the award still depends only on a duration.
 */
function roundBoxes(opts: {
  firstCaller: Role;
  heldMs: number;
  rate: number;
  trueOffset: number;
  estOffset: number;
}): number {
  const config = { ...DEFAULT_CONFIG, fillRateMs: opts.rate };
  const sheet = generateSheet(1, config);
  let s = applyEvent({} as GameState, {
    type: 'START',
    firstCaller: opts.firstCaller,
    sheet,
    config,
  });
  const value = sheet.numbers[0].value;
  const T0 = 1_000_000; // an arbitrary host-frame instant for the call

  // timestamps are real (integer-ms) wall-clock readings, rounded like Date.now
  let callTime: number;
  let bellTime: number;
  if (opts.firstCaller === 'host') {
    // host caller (native clock); guest searcher converts its bell to host time
    callTime = T0;
    const guestReadingAtBell = T0 + opts.heldMs + opts.trueOffset;
    bellTime = Math.round(toHostTime(guestReadingAtBell, opts.estOffset));
  } else {
    // guest caller converts its per-cell timestamps; host searcher rings natively
    callTime = Math.round(toHostTime(T0 + opts.trueOffset, opts.estOffset));
    bellTime = T0 + opts.heldMs;
  }

  s = applyEvent(s, { type: 'CALL', number: value, callTime });
  // the caller completes cell i at callTime + i*rate (host time); only cells
  // finishing at/before the bell count for the round
  const cells = Math.max(0, Math.floor((bellTime - callTime) / opts.rate));
  for (let i = 1; i <= cells; i++) {
    s = applyEvent(s, { type: 'CELL_FILL', t: callTime + i * opts.rate });
  }
  s = applyEvent(s, { type: 'BELL', bellTime });
  return s.filled[opts.firstCaller];
}

describe('clock-sync fairness under network conditions', () => {
  it('symmetric latency (even very high) yields an exact, unbiased award', () => {
    const rng = mulberry32(12345);
    const rate = 400;
    const heldMs = 2200; // mid-box: residual error (<40ms) can't flip the floor
    const ideal = Math.floor(heldMs / rate); // 5

    // sweep many random offsets and symmetric latencies up to 0.5s each way
    for (let i = 0; i < 200; i++) {
      const trueOffset = (rng() - 0.5) * 20000; // ±10s clock skew
      const base = rng() * 500; // up to 500ms each way
      const jitter = rng() * 60;
      const est = estimateOffset(trueOffset, symmetric(rng, base, jitter));

      // offset error is tiny for symmetric links (jitter residual only)
      const eps = est + trueOffset;
      expect(Math.abs(eps)).toBeLessThan(40);

      // both role orderings award exactly the ideal box count
      expect(roundBoxes({ firstCaller: 'host', heldMs, rate, trueOffset, estOffset: est })).toBe(ideal);
      expect(roundBoxes({ firstCaller: 'guest', heldMs, rate, trueOffset, estOffset: est })).toBe(ideal);
    }
  });

  it('asymmetric latency error is bounded by ~asymmetry/2 and cancels across roles', () => {
    const rng = mulberry32(999);
    const rate = 400;
    const heldMs = 2200; // chosen off a floor boundary
    const ideal = Math.floor(heldMs / rate); // 5
    const up = 300;
    const down = 40;
    const trueOffset = 4321;

    const est = estimateOffset(trueOffset, asymmetric(rng, up, down, 20));
    const eps = est + trueOffset; // residual offset error

    // error sits near (up - down) / 2 = 130ms
    expect(Math.abs(eps)).toBeGreaterThan(90);
    expect(Math.abs(eps)).toBeLessThan(170);

    const a = roundBoxes({ firstCaller: 'host', heldMs, rate, trueOffset, estOffset: est });
    const b = roundBoxes({ firstCaller: 'guest', heldMs, rate, trueOffset, estOffset: est });

    // each side is within a single box of fair...
    expect(Math.abs(a - ideal)).toBeLessThanOrEqual(1);
    expect(Math.abs(b - ideal)).toBeLessThanOrEqual(1);
    // ...and the opposite-sign errors cancel over alternating turns
    expect(a + b).toBe(2 * ideal);
  });

  it('heavy jitter is tamed by lowest-RTT sample selection', () => {
    const rng = mulberry32(7);
    const rate = 400;
    const heldMs = 3000;
    const ideal = Math.floor(heldMs / rate); // 7

    // symmetric base but very spiky jitter; min-RTT should still pin the offset
    for (let i = 0; i < 100; i++) {
      const trueOffset = (rng() - 0.5) * 5000;
      const est = estimateOffset(trueOffset, symmetric(rng, 80, 400), 20);
      const a = roundBoxes({ firstCaller: 'host', heldMs, rate, trueOffset, estOffset: est });
      const b = roundBoxes({ firstCaller: 'guest', heldMs, rate, trueOffset, estOffset: est });
      expect(Math.abs(a - ideal)).toBeLessThanOrEqual(1);
      expect(Math.abs(b - ideal)).toBeLessThanOrEqual(1);
    }
  });
});

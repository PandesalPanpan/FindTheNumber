/**
 * The fairness core. Boxes earned in a round depend only on a DURATION, so
 * network latency only affects how we measure that duration, never the rule.
 */
export function boxesForDuration(durationMs: number, fillRateMs: number): number {
  if (durationMs <= 0) return 0;
  return Math.floor(durationMs / fillRateMs);
}

export interface ClockSample {
  /** client clock when ping was sent */
  tSent: number;
  /** host clock stamped in the pong */
  tHost: number;
  /** client clock when pong was received */
  tRecv: number;
}

export function rttOf(sample: ClockSample): number {
  return sample.tRecv - sample.tSent;
}

/**
 * Estimate the offset to add to a client timestamp to convert it to host time,
 * using the lowest-RTT sample (NTP-style). offset = tHost - (midpoint of send/recv).
 */
export function bestOffset(samples: ClockSample[]): number {
  if (samples.length === 0) return 0;
  let best = samples[0];
  let bestRtt = rttOf(best);
  for (const s of samples) {
    const r = rttOf(s);
    if (r < bestRtt) {
      best = s;
      bestRtt = r;
    }
  }
  const clientMidpoint = best.tSent + bestRtt / 2;
  return best.tHost - clientMidpoint;
}

export function toHostTime(tClient: number, offset: number): number {
  return tClient + offset;
}

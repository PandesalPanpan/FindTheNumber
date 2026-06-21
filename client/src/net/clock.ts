import { bestOffset, ClockSample } from '@ftn/shared';
import { Transport } from './transport.js';

/**
 * NTP-style clock sync. The guest sends pings; the host answers each with its
 * own clock. The guest keeps the lowest-RTT sample and derives the offset to
 * add to its local clock to obtain host time. The host's offset is 0.
 *
 * Game-message types reserved here: { t:'ping', id, tSent } and
 * { t:'pong', id, tSent, tHost }.
 */
export function answerPings(transport: Transport): () => void {
  // host side: reply to every ping immediately with host clock
  return transport.onMessage((m) => {
    if (m?.t === 'ping') {
      transport.send({ t: 'pong', id: m.id, tSent: m.tSent, tHost: Date.now() });
    }
  });
}

export function syncClock(
  transport: Transport,
  opts: { rounds?: number; intervalMs?: number } = {},
): Promise<number> {
  const rounds = opts.rounds ?? 8;
  const intervalMs = opts.intervalMs ?? 120;
  const samples: ClockSample[] = [];

  return new Promise((resolve) => {
    let sent = 0;
    const off = transport.onMessage((m) => {
      if (m?.t === 'pong') {
        samples.push({ tSent: m.tSent, tHost: m.tHost, tRecv: Date.now() });
        if (samples.length >= rounds) {
          off();
          clearInterval(timer);
          resolve(bestOffset(samples));
        }
      }
    });

    const timer = setInterval(() => {
      if (sent >= rounds) return;
      sent++;
      transport.send({ t: 'ping', id: sent, tSent: Date.now() });
    }, intervalMs);

    // safety: resolve with whatever we have after a generous window
    setTimeout(() => {
      off();
      clearInterval(timer);
      resolve(bestOffset(samples));
    }, intervalMs * rounds + 2000);
  });
}

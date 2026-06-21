import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, SignalingServer } from '../src/server.js';
import { Client, newClient as connect } from './wsClient.js';

let server: SignalingServer;
let url: string;

beforeAll(async () => {
  server = await startServer({ port: 0, graceMs: 1000 });
  url = `ws://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  await server.close();
});

const newClient = () => connect(url);

/** Pair a single room: returns connected, joined host+guest clients. */
async function pairRoom() {
  const host = await newClient();
  host.send({ t: 'create' });
  const j = await host.next('joined', 8000);
  const guest = await newClient();
  guest.send({ t: 'join', room: j.room });
  await guest.next('joined', 8000);
  await host.next('peer-joined', 8000);
  return { host, guest, code: j.room as string };
}

describe('signaling server under concurrent load', () => {
  it('pairs many rooms simultaneously and isolates relay traffic', async () => {
    const ROOMS = 60; // 120 concurrent connections
    const t0 = Date.now();

    const rooms = await Promise.all(Array.from({ length: ROOMS }, () => pairRoom()));

    // every room got a unique code
    const codes = new Set(rooms.map((r) => r.code));
    expect(codes.size).toBe(ROOMS);

    // each guest relays a uniquely tagged message; the matching host must get
    // exactly that one (no cross-room leakage)
    const latencies: number[] = [];
    await Promise.all(
      rooms.map(async (r, i) => {
        const sent = Date.now();
        r.guest.send({ t: 'relay', payload: { room: i, nonce: `n${i}` } });
        const got = await r.host.next('relay', 8000);
        latencies.push(Date.now() - sent);
        expect(got.payload).toEqual({ room: i, nonce: `n${i}` });
      }),
    );

    const elapsed = Date.now() - t0;
    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    // eslint-disable-next-line no-console
    console.log(
      `[load] ${ROOMS} rooms paired + round-tripped in ${elapsed}ms ` +
        `(relay p50=${p50}ms p95=${p95}ms)`,
    );

    // sanity: relay round-trips are quick even under concurrency
    expect(p95).toBeLessThan(1000);

    rooms.forEach((r) => {
      r.host.close();
      r.guest.close();
    });
  });

  it('keeps serving new rooms after a burst of churn', async () => {
    // rapidly create+drop rooms, then confirm the server still pairs cleanly
    const churn = await Promise.all(Array.from({ length: 40 }, () => pairRoom()));
    churn.forEach((r) => {
      r.host.close();
      r.guest.close();
    });
    await new Promise((res) => setTimeout(res, 50));

    const fresh = await pairRoom();
    const c: Client = fresh.guest;
    c.send({ t: 'relay', payload: { ok: true } });
    const got = await fresh.host.next('relay', 8000);
    expect(got.payload).toEqual({ ok: true });
    fresh.host.close();
    fresh.guest.close();
  });
});

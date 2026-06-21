/**
 * Tunable load test for the signaling/relay server.
 *
 *   ROOMS=500 MSGS=20 npm -w server run loadtest
 *
 * Spins up an in-process server, opens ROOMS rooms (2*ROOMS connections), and
 * fires MSGS relay round-trips per room, reporting throughput and latency.
 * Set SERVER_URL=ws://host:port to hit an already-running server instead.
 */
import { WebSocket } from 'ws';
import { startServer, SignalingServer } from './src/server.js';

const ROOMS = Number(process.env.ROOMS ?? 200);
const MSGS = Number(process.env.MSGS ?? 10);
const EXTERNAL = process.env.SERVER_URL;

class C {
  ws: WebSocket;
  private q: any[] = [];
  private w: { t: string; res: (m: any) => void; rej: (e: any) => void; timer: any }[] = [];
  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      const i = this.w.findIndex((x) => x.t === m.t);
      if (i >= 0) {
        const [x] = this.w.splice(i, 1);
        clearTimeout(x.timer);
        x.res(m);
      } else this.q.push(m);
    });
  }
  open() {
    return new Promise<void>((res, rej) => {
      this.ws.on('open', () => res());
      this.ws.on('error', rej);
    });
  }
  send(o: any) {
    this.ws.send(JSON.stringify(o));
  }
  next(t: string, timeoutMs = 15000): Promise<any> {
    const i = this.q.findIndex((m) => m.t === t);
    if (i >= 0) return Promise.resolve(this.q.splice(i, 1)[0]);
    return new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error(`timeout '${t}'`)), timeoutMs);
      this.w.push({ t, res, rej, timer });
    });
  }
  close() {
    this.ws.close();
  }
}

async function main() {
  let server: SignalingServer | null = null;
  let url = EXTERNAL ?? '';
  if (!EXTERNAL) {
    server = await startServer({ port: 0, graceMs: 5000 });
    url = `ws://127.0.0.1:${server.port}`;
  }
  console.log(`[loadtest] target=${url} rooms=${ROOMS} msgs/room=${MSGS}`);

  async function pairRoom() {
    const host = new C(url);
    await host.open();
    host.send({ t: 'create' });
    const j = await host.next('joined');
    const guest = new C(url);
    await guest.open();
    guest.send({ t: 'join', room: j.room });
    await guest.next('joined');
    await host.next('peer-joined');
    return { host, guest };
  }

  // open connections in chunks so we don't overrun the OS listen backlog
  const CHUNK = 100;
  const tStart = Date.now();
  const rooms: { host: C; guest: C }[] = [];
  for (let i = 0; i < ROOMS; i += CHUNK) {
    const n = Math.min(CHUNK, ROOMS - i);
    rooms.push(...(await Promise.all(Array.from({ length: n }, () => pairRoom()))));
  }
  const pairMs = Date.now() - tStart;
  console.log(
    `[loadtest] paired ${ROOMS} rooms (${ROOMS * 2} conns) in ${pairMs}ms ` +
      `= ${((ROOMS / pairMs) * 1000).toFixed(0)} rooms/s`,
  );

  const lat: number[] = [];
  const tMsg = Date.now();
  await Promise.all(
    rooms.map(async ({ host, guest }) => {
      for (let i = 0; i < MSGS; i++) {
        const sent = Date.now();
        guest.send({ t: 'relay', payload: { i } });
        await host.next('relay');
        lat.push(Date.now() - sent);
      }
    }),
  );
  const msgMs = Date.now() - tMsg;
  const total = ROOMS * MSGS;
  lat.sort((a, b) => a - b);
  const pct = (p: number) => lat[Math.min(lat.length - 1, Math.floor(lat.length * p))];
  console.log(
    `[loadtest] ${total} relay round-trips in ${msgMs}ms ` +
      `= ${((total / msgMs) * 1000).toFixed(0)} msg/s | ` +
      `latency p50=${pct(0.5)}ms p95=${pct(0.95)}ms p99=${pct(0.99)}ms max=${lat[lat.length - 1]}ms`,
  );

  rooms.forEach((r) => {
    r.host.close();
    r.guest.close();
  });
  await server?.close();
  console.log('[loadtest] done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

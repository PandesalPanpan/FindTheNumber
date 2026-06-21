import { startServer } from './server.js';

const port = Number(process.env.PORT ?? 8787);
const graceMs = Number(process.env.RECONNECT_GRACE_MS ?? 15000);

startServer({ port, graceMs }).then((s) => {
  console.log(`[ftn] signaling/relay listening on :${s.port}`);
});

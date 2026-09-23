# Find the Number

A real-time, two-player web version of the TikTok "find the number on the
flipped paper / slap the bell" game.

- **Shared mirrored sheet** of scattered handwritten numbers (flipped so they
  read backwards). Found numbers get a hand-drawn circle (rough.js).
- Each player fills a **10×10 grid**. On your turn you **call a number**; your
  opponent must **find it and slap the bell** while you **hold to scribble Xs**
  at a fixed rate. First to fill 100 boxes wins.
- **WebRTC peer-to-peer** gameplay with a **WebSocket relay fallback**; a tiny
  signaling server (also the relay) is the only backend. Fairness is structural:
  boxes earned = `floor(heldTime / fillRate)`, computed host-authoritatively on
  an NTP-synced clock, so latency never changes the outcome.

See [`.claude/plan/PLAN.md`](.claude/plan/PLAN.md) for the full design.

## Layout

```
shared/   deterministic game core (types, sheet RNG, scoring, engine) + unit tests
server/   Node + ws signaling/relay server
client/   Vite + React + TS app (rough.js, mobile-first)
e2e/      Playwright two-player tests
```

## Develop (local)

```bash
npm install
npm run dev          # server :8787 + client :5180 (Vite proxies /ws -> server)
```

Open http://localhost:5180, click **Create a game**, share the room link/code.

## Test

```bash
npm test             # unit + integration: fairness core, sheet determinism,
                     # engine, clock-sync fairness simulation (latency/jitter/
                     # asymmetry), and signaling-server + concurrency tests
npm run e2e:install  # one-time: install Playwright Chromium
npm run e2e          # two-context E2E: full match over relay AND real P2P,
                     # both first-caller paths, instant-win-by-holding, sheet
                     # regeneration, rematch tally, wrong-number, disconnect grace
```

Heavier, tunable load test against the signaling/relay server:

```bash
ROOMS=500 MSGS=20 npm -w server run loadtest
# pairs ROOMS rooms (2*ROOMS connections) and fires MSGS relay round-trips each,
# reporting rooms/s, msg/s and latency percentiles. Set SERVER_URL=ws://host:port
# to target an already-running server.
```

## Develop with Docker (hot reload)

```bash
docker compose -f docker-compose.dev.yml up
# client: http://localhost:5180   server: ws://localhost:8787
```

## Local Docker build (from source)

```bash
docker compose up --build
# web: http://localhost:8080
```

`docker-compose.yml` builds both services from the current checkout. The web
container uses nginx for the static app and proxies `/ws` to `server:8787` on
the Compose network.

## Production deployment (Dokploy)

Production uses published, explicitly versioned Docker Hub images through
[`docker-compose.prod.yml`](docker-compose.prod.yml):

- Web: `pandesalpanpan/findthenumber:0.3.2`
- Signaling server: `pandesalpanpan/findthenumber-server:0.2.0`

In Dokploy, create a **Docker Compose** application using
`docker-compose.prod.yml`. Ensure the external `dokploy-network` exists, then
route the public domain to the `web` service on container port **80**. Do not
route the domain to the server or publish port **8787**. nginx serves the web
app and proxies same-origin `/ws` requests internally to `server:8787`; the
server remains reachable only on the Compose default network. No `latest` tag
is used for deployment.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Find the Number** — a real-time, two-player web version of the TikTok "find the
number on the flipped paper / slap the bell" game. On your turn you call a number;
your opponent finds it on a shared mirrored sheet and slaps the bell while you
press-and-hold boxes to scribble Xs. First to fill their grid wins.

npm **workspaces** monorepo: `shared` (deterministic game core), `server` (signaling/relay), `client` (React SPA).

## Commands

```bash
npm install
npm run dev            # server :8787 + client :5180 (Vite proxies /ws -> server)
npm run build          # builds shared then client (shared MUST build first)
npm test               # shared unit/integration + server tests (vitest)
npm run e2e:install    # one-time: install Playwright Chromium
npm run e2e            # two-player Playwright suite (auto-starts both servers)
```

Per-package / single-test:
```bash
npm -w shared run test                          # just the game-core tests
npm -w shared run test -- engine                # one vitest file by name match
npx playwright test e2e/game.spec.ts            # one e2e file
npx playwright test -g "instant"                # e2e by title grep
ROOMS=500 MSGS=20 npm -w server run loadtest    # tunable relay load test
npm -w client run og                            # regenerate the social share card (public/og.png)
```

**Always rebuild `shared` after editing it** (`npm -w shared run build`) — `server`
and `client` consume its compiled `dist`, so stale builds cause confusing failures.

## Architecture

**Authoritative host model.** There is no game logic on the server — it is only a
WebSocket **signaling + relay** service (`server/src/server.ts`). One peer is the
**host** and runs the authoritative engine; the **guest** sends intents and renders
host-broadcast snapshots.

- `shared/src/engine.ts` — `applyEvent(state, event)` is a **pure reducer**. All
  timestamps are HOST time. Events: `START`, `CALL`, `CELL_FILL`, `BELL`,
  `NEW_SHEET`, `RESET`. Both peers can run it (guest for prediction); only the host's
  result is authoritative.
- **Fairness is structural, not trust-based.** On each `CELL_FILL` the host caps banked
  boxes to `floor((now - callTime) / fillRate)` (`shared/src/scoring.ts`), so latency
  can delay an award but never inflate it. `shared/test/fairness-sim.test.ts` simulates
  latency/jitter/clock-asymmetry against the real engine.
- `shared/src/sheet.ts` + `rng.ts` — **deterministic** sheet generation: same
  `seed + config` produces an identical sheet on every peer (seeded mulberry32).
- `shared/src/types.ts` — `GameConfig`, `DEFAULT_CONFIG`, and config bounds. Two
  distinct bound sets: **`CONFIG_LIMITS`** = tight UI-recommended ranges the lobby uses;
  **`normalizeConfig()`** clamps to wider internal **safety** bounds only. Keep
  `normalizeConfig` safety-only — it is the final guardrail for the URL-param path, and
  e2e tests pass deliberate extreme values (`grid=2`, `count=3`, `rate=100000`) that
  must survive it.

**Client netcode** (`client/src/net/`): `useGame.ts` is the single hook holding all game
state and the host/guest split. `signaling.ts` (room create/join over `/ws`),
`transport.ts` (WebRTC P2P with WebSocket-relay fallback), `clock.ts` (NTP-style offset
sync so the guest can express host-time). Config travels host→guest inside the `START`
state snapshot — there is **no separate config message**.

**Config flow:** host builds `GameConfig` in `useGame.buildConfig()` from
`DEFAULT_CONFIG` ← URL params (`?grid=&count=&rate=`) ← lobby choice (`createRoom(config)`),
then `normalizeConfig`. The lobby (`client/src/ui/Lobby.tsx`) offers presets + an Advanced
panel and persists to `localStorage`.

## SEO / analytics / config-injection

`.env` files are **gitignored**, so build-time values are baked by an html-transform
plugin in `client/vite.config.ts` that replaces `__PUBLIC_URL__` and `__GA_ID__` tokens
in `index.html`. Defaults live in `vite.config.ts` (public origin
`findthenumber.marticio.com`, GA4 `G-LPX9PZDF83`); override with `VITE_PUBLIC_URL` /
`VITE_GA_ID` build args/env (set `VITE_GA_ID=''` to disable analytics).
**Do not use Vite's `%VITE_*%` syntax in index.html** — it collides with Vite's URL
percent-decoding and breaks the build; use the `__TOKEN__` form handled by the plugin.
`og.png`, `robots.txt`, `sitemap.xml` live in `client/public/`.

## Deploy & versioning

Production runs via `docker compose` (Dokploy/Traefik terminates TLS). The `web` (nginx)
service serves the static client and proxies `/ws` to the `server` service on one origin.

The published image **`pandesalpanpan/findthenumber` is the client/web image only** (built
from `client/Dockerfile`, **context = repo root**); the server is not published under this
repo. Image tags track the **root `package.json` version** plus `latest`.

**Release a new version:**
1. Bump the version in the **root `package.json`** (minor for features, patch for fixes).
   Check the latest published tag first:
   `curl -s https://hub.docker.com/v2/repositories/pandesalpanpan/findthenumber/tags`.
2. Gate before building (standing requirement): `npm test` **and** `npm run e2e` must pass,
   plus a manual smoke of the lobby/board.
3. Build and push both tags:
   ```bash
   docker build -f client/Dockerfile -t pandesalpanpan/findthenumber:<ver> -t pandesalpanpan/findthenumber:latest .
   docker push pandesalpanpan/findthenumber:<ver> && docker push pandesalpanpan/findthenumber:latest
   ```
   Docker Desktop's daemon is often not running on this machine — start it and poll
   `docker info` before building. Hub auth uses the `desktop` credsStore.

## Git workflow

**Never commit directly to `main`.** Do feature work on a branch
(`feat/...`, `fix/...`, `chore/...`), commit **one logical feature per commit**
(separate gameplay / UI / SEO / infra changes), then merge back to `main` with
`--no-ff` so the feature history is preserved. End commit messages with the
`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer. Commit or push only
when asked.

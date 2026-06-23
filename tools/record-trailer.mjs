// Find the Number — landing-page trailer generator.
//
// Drives a real two-player match in Playwright, recording the host and guest
// pages separately (each a 430x932 phone), with a fake cursor (click ripple +
// press-and-hold glow) injected and the dev/status chrome hidden. Then ffmpeg
// stacks the two side-by-side, speed-ramps the slow lobby/connect segment,
// muxes a generated chiptune bed, and encodes trailer.mp4 + trailer.webm +
// trailer-poster.jpg into client/public/.
//
//   npm run trailer
//
// Requires: ffmpeg + ffprobe on PATH (winget install Gyan.FFmpeg) and the
// project's Playwright Chromium (npm run e2e:install). Starts/stops the dev
// servers itself unless they are already up. Kept out of e2e/ so it never runs
// with `npm run e2e`.

import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, copyFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = join(ROOT, 'tools', '.trailer-build');
const RAW = join(BUILD, 'raw');
const PUBLIC = join(ROOT, 'client', 'public');

const CLIENT_URL = 'http://localhost:5180';
const HEALTH_URL = 'http://localhost:8787/health';

// Phone viewport (mobile-first portrait, matches playwright.config).
const VW = 430;
const VH = 932;
const RATE = 130; // ms/cell fill — fast, snappy scribbles

// Speed-ramp factors (slow lobby/connect runs faster than gameplay).
const PRE_SPEED = 1.7; // lobby → board
const PLAY_SPEED = 1.12; // gameplay → win

// ---------------------------------------------------------------------------
// ffmpeg / ffprobe resolution
// ---------------------------------------------------------------------------
function resolveExe(name) {
  if (spawnSync(name, ['-version'], { shell: true }).status === 0) return name;
  // winget (Gyan.FFmpeg) install location fallback
  const wg = join(
    process.env.LOCALAPPDATA || '',
    'Microsoft',
    'WinGet',
    'Packages',
  );
  if (existsSync(wg)) {
    for (const pkg of readdirSync(wg)) {
      if (!pkg.startsWith('Gyan.FFmpeg')) continue;
      const pkgDir = join(wg, pkg);
      for (const sub of readdirSync(pkgDir)) {
        const exe = join(pkgDir, sub, 'bin', `${name}.exe`);
        if (existsSync(exe)) return exe;
      }
    }
  }
  throw new Error(`${name} not found — install ffmpeg (winget install Gyan.FFmpeg)`);
}
const FFMPEG = resolveExe('ffmpeg');
const FFPROBE = resolveExe('ffprobe');

function run(exe, args) {
  const r = spawnSync(exe, args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${exe} failed (exit ${r.status})`);
}
function probeDuration(file) {
  const r = spawnSync(FFPROBE, [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1', file,
  ]);
  return parseFloat(String(r.stdout).trim());
}

// ---------------------------------------------------------------------------
// dev servers
// ---------------------------------------------------------------------------
async function isUp(url) {
  try {
    const r = await fetch(url);
    return r.ok || r.status === 426 || r.status === 400; // /ws upgrade etc.
  } catch {
    return false;
  }
}
async function waitUp(url, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await isUp(url)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
function startServers() {
  const procs = [];
  const spawnNpm = (args, env) =>
    spawn('npm', args, { cwd: ROOT, shell: true, stdio: 'ignore', env: { ...process.env, ...env } });
  procs.push(spawnNpm(['-w', 'server', 'run', 'start'], { RECONNECT_GRACE_MS: '2500' }));
  procs.push(spawnNpm(['-w', 'client', 'run', 'dev'], {}));
  return procs;
}
function killTree(proc) {
  if (!proc || proc.killed) return;
  try {
    spawnSync('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { stdio: 'ignore' });
  } catch {
    proc.kill('SIGKILL');
  }
}

// ---------------------------------------------------------------------------
// injected page chrome: fake cursor + hide dev/status pills
// ---------------------------------------------------------------------------
const INIT_SCRIPT = `
(() => {
  const css = document.createElement('style');
  css.textContent = \`
    /* hide transport pill + mute button for a clean board */
    .pill.relay, .pill.p2p, .pill.mute { display: none !important; }
    #ftn-cursor {
      position: fixed; left: 0; top: 0; width: 26px; height: 26px;
      margin: -13px 0 0 -13px; border-radius: 50%;
      background: radial-gradient(circle at 35% 35%, #fff, #2a6ee0 70%);
      box-shadow: 0 2px 6px rgba(0,0,0,.45);
      pointer-events: none; z-index: 2147483647;
      transition: transform .05s linear; will-change: left, top, transform;
    }
    #ftn-cursor.down { transform: scale(.8); }
    #ftn-cursor .glow {
      position: absolute; inset: -10px; border-radius: 50%;
      border: 3px solid rgba(42,110,224,.6); opacity: 0;
    }
    #ftn-cursor.down .glow { animation: ftn-glow .6s ease-out infinite; }
    @keyframes ftn-glow {
      0% { transform: scale(.7); opacity: .8; }
      100% { transform: scale(1.5); opacity: 0; }
    }
    .ftn-ripple {
      position: fixed; width: 14px; height: 14px; margin: -7px 0 0 -7px;
      border-radius: 50%; border: 3px solid #2a6ee0;
      pointer-events: none; z-index: 2147483646; animation: ftn-rip .5s ease-out forwards;
    }
    @keyframes ftn-rip {
      0% { transform: scale(.3); opacity: .9; }
      100% { transform: scale(3.2); opacity: 0; }
    }
  \`;
  const mount = () => {
    if (document.getElementById('ftn-cursor')) return;
    document.documentElement.appendChild(css);
    const cur = document.createElement('div');
    cur.id = 'ftn-cursor';
    cur.innerHTML = '<div class="glow"></div>';
    document.documentElement.appendChild(cur);
    const move = (x, y) => { cur.style.left = x + 'px'; cur.style.top = y + 'px'; };
    addEventListener('pointermove', (e) => move(e.clientX, e.clientY), true);
    addEventListener('mousemove', (e) => move(e.clientX, e.clientY), true);
    const down = (e) => {
      cur.classList.add('down');
      const r = document.createElement('div');
      r.className = 'ftn-ripple';
      r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
      document.documentElement.appendChild(r);
      setTimeout(() => r.remove(), 520);
    };
    const up = () => cur.classList.remove('down');
    addEventListener('pointerdown', down, true);
    addEventListener('mousedown', down, true);
    addEventListener('pointerup', up, true);
    addEventListener('mouseup', up, true);
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', mount);
  else mount();
})();
`;

// ---------------------------------------------------------------------------
// driving helpers
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function center(locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error('no bounding box for ' + locator);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
async function glide(page, locator, steps = 18) {
  const { x, y } = await center(locator);
  await page.mouse.move(x, y, { steps });
  return { x, y };
}
async function tap(page, locator, steps = 18) {
  await locator.waitFor({ state: 'visible', timeout: 15000 });
  await glide(page, locator, steps);
  await sleep(120);
  await page.mouse.down();
  await sleep(70);
  await page.mouse.up();
}
async function waitBanner(page, text) {
  await page.waitForFunction(
    (t) => document.querySelector('[data-testid=banner]')?.textContent?.includes(t),
    text,
    { timeout: 20000 },
  );
}
const td = (page, id) => page.getByTestId(id);

// fill `count` empty boxes on the caller's own grid, starting at `from`.
async function scribble(page, from, count) {
  for (let i = from; i < from + count; i++) {
    const box = td(page, `my-box-${i}`);
    await box.waitFor({ state: 'visible', timeout: 10000 });
    const { x, y } = await center(box);
    await page.mouse.move(x, y, { steps: 6 });
    await page.mouse.down();
    await sleep(RATE + 70); // hold past the fill rate so the cell commits
    await page.mouse.up();
    await sleep(60);
  }
}

// caller calls a number; returns the called value as a string.
async function callNumber(page) {
  const num = page.locator('.sheet-num:not([disabled])').first();
  await num.waitFor({ state: 'visible', timeout: 10000 });
  const value = await num.getAttribute('data-value');
  await tap(page, num);
  return value;
}

// searcher "hunts" (wanders over a couple of wrong numbers) for show.
async function hunt(page, exclude) {
  const wrongs = page.locator(`.sheet-num:not([disabled]):not([data-value="${exclude}"])`);
  const n = Math.min(2, await wrongs.count());
  for (let i = 0; i < n; i++) {
    await glide(page, wrongs.nth(i), 12);
    await sleep(280);
  }
}

// searcher finds the number and slaps the bell.
async function findAndRing(page, value) {
  await td(page, 'find-target').waitFor({ state: 'visible', timeout: 15000 });
  await hunt(page, value);
  await tap(page, td(page, `num-${value}`));
  const bell = td(page, 'bell');
  await page.waitForFunction(() => {
    const b = document.querySelector('[data-testid=bell]');
    return b && !b.hasAttribute('disabled');
  }, null, { timeout: 10000 });
  await tap(page, bell);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  mkdirSync(RAW, { recursive: true });
  mkdirSync(PUBLIC, { recursive: true });

  // 0) chiptune
  const wav = join(BUILD, 'chiptune.wav');
  run('node', [join(ROOT, 'tools', 'make-chiptune.mjs'), wav]);

  // 1) servers
  let spawned = [];
  const reuse = (await isUp(CLIENT_URL)) && (await isUp(HEALTH_URL));
  if (reuse) {
    console.log('• reusing already-running dev servers');
  } else {
    console.log('• starting dev servers…');
    spawned = startServers();
    if (!(await waitUp(HEALTH_URL, 40000))) throw new Error('server did not come up');
    if (!(await waitUp(CLIENT_URL, 60000))) throw new Error('client did not come up');
  }

  const browser = await chromium.launch();
  let hostVidPath, guestVidPath, markerSec;
  try {
    const ctxOpts = {
      viewport: { width: VW, height: VH },
      recordVideo: { dir: RAW, size: { width: VW, height: VH } },
    };
    const hostCtx = await browser.newContext(ctxOpts);
    const guestCtx = await browser.newContext(ctxOpts);
    await hostCtx.addInitScript(INIT_SCRIPT);
    await guestCtx.addInitScript(INIT_SCRIPT);
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();

    // both recordings begin ~here
    const t0 = Date.now();
    await Promise.all([
      host.goto(`${CLIENT_URL}/?transport=relay&first=host&rate=${RATE}`),
      guest.goto(`${CLIENT_URL}/?transport=relay`),
    ]);
    await sleep(700);

    // --- BEAT: select configuration (host) ---
    await tap(host, td(host, 'preset-quick'));
    await sleep(450);
    await tap(host, td(host, 'advanced-toggle')); // reveal the knobs
    await sleep(900);
    await tap(host, td(host, 'advanced-toggle')); // tuck them away
    await sleep(300);

    // --- BEAT: create + invite (host) ---
    await tap(host, td(host, 'create'));
    await td(host, 'room-code').waitFor({ state: 'visible', timeout: 15000 });
    const code = (await td(host, 'room-code').textContent()).trim();
    await sleep(500);
    // click the "Copy invite link" button (shows the ✓ Copied! beat)
    await tap(host, host.locator('.big-btn.join'));
    await sleep(900);

    // --- BEAT: guest types the code + joins ---
    await tap(guest, td(guest, 'code-input'));
    await td(guest, 'code-input').pressSequentially(code, { delay: 130 });
    await sleep(350);
    await tap(guest, td(guest, 'join'));

    // --- both reach the board ---
    await Promise.all([
      td(host, 'board').waitFor({ state: 'visible', timeout: 25000 }),
      td(guest, 'board').waitFor({ state: 'visible', timeout: 25000 }),
    ]);
    markerSec = (Date.now() - t0) / 1000; // speed-ramp split point
    await waitBanner(host, 'YOUR TURN');
    await sleep(900);

    // === Cycle 1: host calls, scribbles 6, guest finds + bell ===
    let v = await callNumber(host);
    await waitBanner(host, 'HOLD');
    await Promise.all([scribble(host, 0, 6), hunt(guest, v)]);
    await findAndRing(guest, v);
    await sleep(500);

    // === Cycle 2: guest calls, scribbles 4 (opp progress), host finds + bell ===
    await waitBanner(guest, 'YOUR TURN');
    v = await callNumber(guest);
    await waitBanner(guest, 'HOLD');
    await Promise.all([scribble(guest, 0, 4), hunt(host, v)]);
    await findAndRing(host, v);
    await sleep(500);

    // === Cycle 3 (match point): host calls, rapid-fills to 25 → WIN ===
    await waitBanner(host, 'YOUR TURN');
    v = await callNumber(host);
    await waitBanner(host, 'HOLD');
    await hunt(guest, v); // guest keeps "searching" but never bells
    await scribble(host, 6, 19); // 6 + 19 = 25 cells → instant win
    await td(host, 'end-screen').waitFor({ state: 'visible', timeout: 15000 });

    // hold on the WIN screen before the loop seam fades back to the start
    await sleep(1600);

    hostVidPath = await host.video().path();
    guestVidPath = await guest.video().path();
    await hostCtx.close();
    await guestCtx.close();
  } finally {
    await browser.close();
    for (const p of spawned) killTree(p);
  }

  // ---------------------------------------------------------------------------
  // 2) ffmpeg: stack + speed-ramp + fades + music
  // ---------------------------------------------------------------------------
  console.log('• compositing…');
  const D = Math.min(probeDuration(hostVidPath), probeDuration(guestVidPath));
  const M = Math.min(markerSec, D - 1);
  const finalDur = M / PRE_SPEED + (D - M) / PLAY_SPEED;
  const fadeOutAt = Math.max(0.1, finalDur - 0.6);
  console.log(`  raw=${D.toFixed(1)}s marker=${M.toFixed(1)}s → final≈${finalDur.toFixed(1)}s`);

  const combined = join(BUILD, 'combined.mp4');
  const filter =
    `[0:v]fps=30,setsar=1[h];` +
    `[1:v]fps=30,setsar=1[g];` +
    `[h][g]hstack=inputs=2[st];` +
    `[st]split=2[s0][s1];` +
    `[s0]trim=0:${M.toFixed(3)},setpts=PTS/${PRE_SPEED}[a];` +
    `[s1]trim=start=${M.toFixed(3)},setpts=(PTS-STARTPTS)/${PLAY_SPEED}[b];` +
    `[a][b]concat=n=2:v=1[cc];` +
    `[cc]fade=t=in:st=0:d=0.4,fade=t=out:st=${fadeOutAt.toFixed(2)}:d=0.6,format=yuv420p[v]`;
  run(FFMPEG, [
    '-y', '-i', hostVidPath, '-i', guestVidPath,
    '-filter_complex', filter, '-map', '[v]', '-an',
    '-c:v', 'libx264', '-crf', '19', '-preset', 'medium', combined,
  ]);

  const audioFilter =
    `afade=t=in:st=0:d=0.5,` +
    `afade=t=out:st=${Math.max(0.1, finalDur - 1).toFixed(2)}:d=1,` +
    `volume=0.85`;

  const mp4 = join(PUBLIC, 'trailer.mp4');
  run(FFMPEG, [
    '-y', '-stream_loop', '-1', '-i', wav, '-i', combined,
    '-map', '1:v', '-map', '0:a', '-t', finalDur.toFixed(3),
    '-af', audioFilter,
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart', mp4,
  ]);

  const webm = join(PUBLIC, 'trailer.webm');
  run(FFMPEG, [
    '-y', '-stream_loop', '-1', '-i', wav, '-i', combined,
    '-map', '1:v', '-map', '0:a', '-t', finalDur.toFixed(3),
    '-af', audioFilter,
    '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '33',
    '-c:a', 'libopus', '-b:a', '96k', webm,
  ]);

  const poster = join(PUBLIC, 'trailer-poster.jpg');
  run(FFMPEG, [
    '-y', '-ss', (finalDur * 0.55).toFixed(2), '-i', mp4,
    '-frames:v', '1', '-update', '1', '-q:v', '3', poster,
  ]);

  console.log('\n✓ trailer built:');
  for (const f of [mp4, webm, poster]) console.log('  ' + f);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

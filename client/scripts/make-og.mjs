// Generates the 1200x630 social share card (client/public/og.png) by
// screenshotting a styled HTML template. Run: `node client/scripts/make-og.mjs`
// (requires the repo's Playwright + a one-time `npm run e2e:install`).
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = resolve(__dirname, '../public/og.png');

const html = `<!doctype html><html><head><meta charset="utf-8" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&display=swap" rel="stylesheet" />
<style>
  * { margin: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; }
  body {
    font-family: 'Caveat', cursive;
    color: #2b2b2b;
    background:
      repeating-linear-gradient(0deg, transparent 0 56px, rgba(0,0,0,0.05) 56px 58px),
      #f7f1df;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 8px;
    position: relative; overflow: hidden;
  }
  .frame { position: absolute; inset: 24px; border: 6px solid #2b2b2b; border-radius: 28px; }
  .bell { font-size: 150px; line-height: 1; filter: drop-shadow(4px 4px 0 rgba(0,0,0,0.18)); }
  .title { font-size: 132px; font-weight: 700; line-height: 1; }
  .tag {
    font-size: 52px; font-weight: 700; color: #c0392b;
    background: #ffd23f; border: 5px solid #2b2b2b; border-radius: 18px;
    padding: 6px 28px; box-shadow: 6px 6px 0 rgba(0,0,0,0.18);
    transform: rotate(-2deg); margin-top: 10px;
  }
  .sub { font-size: 40px; opacity: 0.7; margin-top: 14px; }
  .scribble { position: absolute; font-weight: 700; opacity: 0.18; }
</style></head>
<body>
  <div class="frame"></div>
  <div class="scribble" style="left:70px; top:60px; font-size:90px; transform:rotate(-12deg) scaleX(-1)">42</div>
  <div class="scribble" style="right:90px; top:90px; font-size:110px; transform:rotate(9deg) scaleX(-1)">7</div>
  <div class="scribble" style="left:120px; bottom:70px; font-size:96px; transform:rotate(6deg) scaleX(-1)">88</div>
  <div class="scribble" style="right:120px; bottom:60px; font-size:80px; transform:rotate(-8deg) scaleX(-1)">15</div>
  <div class="bell">🔔</div>
  <div class="title">Find the Number</div>
  <div class="tag">Free · 2-Player · Online</div>
  <div class="sub">Call · find · slap the bell — no download</div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);
await page.screenshot({ path: out });
await browser.close();
console.log('wrote', out);

import { test, expect, Page, BrowserContext } from '@playwright/test';

interface MatchOpts {
  transport?: 'relay' | 'p2p';
  first?: 'host' | 'guest';
  grid?: number;
  rate?: number;
  count?: number;
  relayDelay?: number; // artificial per-message latency on the relay path (ms)
  throttleMs?: number; // CDP-emulated network latency applied to both peers
}

function hostUrl(o: MatchOpts) {
  const p = new URLSearchParams();
  if (o.transport !== 'p2p') p.set('transport', 'relay');
  if (o.first) p.set('first', o.first);
  p.set('grid', String(o.grid ?? 3));
  p.set('rate', String(o.rate ?? 150));
  p.set('count', String(o.count ?? 12));
  if (o.relayDelay) p.set('relayDelay', String(o.relayDelay));
  return `/?${p.toString()}`;
}

/** Emulate poor network conditions on a page via the CDP Network domain. */
async function emulateLatency(page: Page, latencyMs: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: latencyMs,
    downloadThroughput: -1, // no throughput cap, latency only
    uploadThroughput: -1,
  });
}

// Default: deterministic relay transport + a tiny fast board so a full match
// finishes quickly and timing assertions stay stable.
async function createMatch(browser: BrowserContext['browser'], opts: MatchOpts = {}) {
  const hostCtx = await browser!.newContext();
  const guestCtx = await browser!.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  if (opts.throttleMs) {
    await emulateLatency(host, opts.throttleMs);
    await emulateLatency(guest, opts.throttleMs);
  }

  await host.goto(hostUrl(opts));
  await host.getByTestId('create').click();
  await expect(host.getByTestId('room-code')).toBeVisible();
  const code = (await host.getByTestId('room-code').textContent())!.trim();

  const guestQuery = opts.transport === 'p2p' ? '' : 'transport=relay&';
  await guest.goto(`/?${guestQuery}room=${code}`);

  await expect(host.getByTestId('board')).toBeVisible({ timeout: 20000 });
  await expect(guest.getByTestId('board')).toBeVisible({ timeout: 20000 });
  return { hostCtx, guestCtx, host, guest, code };
}

/**
 * Identify the current caller via the turn banner, waiting until exactly one
 * page LOCALLY believes it's their turn. Robust under network latency, where
 * the two peers' views settle a round-trip apart.
 */
async function rolesNow(host: Page, guest: Page) {
  for (let i = 0; i < 160; i++) {
    const hb = (await host.getByTestId('banner').textContent()) ?? '';
    const gb = (await guest.getByTestId('banner').textContent()) ?? '';
    const hc = hb.includes('YOUR TURN');
    const gc = gb.includes('YOUR TURN');
    if (hc && !gc) return { caller: host, searcher: guest };
    if (gc && !hc) return { caller: guest, searcher: host };
    await host.waitForTimeout(50);
  }
  throw new Error('caller did not settle');
}

async function gridCount(page: Page) {
  const txt = (await page.locator('.grid-wrap.mine .grid-count').textContent()) ?? '0/0';
  return Number(txt.split('/')[0]);
}

/**
 * Press-and-hold `n` individual empty boxes, one at a time, banking one X each.
 * Each hold exceeds the fill rate (max 150ms in these tests) so every cell
 * completes. Stops early if the grid fills and the match ends mid-fill.
 */
async function fillBoxes(page: Page, n: number) {
  for (let k = 0; k < n; k++) {
    if (await page.getByTestId('end-screen').isVisible().catch(() => false)) return;
    const empty = page.locator('.grid-wrap.mine .box:not(.x)').first();
    const box = await empty.boundingBox();
    if (!box) return;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(300); // > fill rate -> the cell inks in and commits
    await page.mouse.up();
    await page.waitForTimeout(40); // let the optimistic commit settle
  }
}

/** Play one round, filling `boxes` cells; returns false if the match ended. */
async function playRound(caller: Page, searcher: Page, boxes: number) {
  const num = await caller
    .locator('.sheet-num:not([disabled])')
    .first()
    .getAttribute('data-value');
  expect(num).toBeTruthy();

  await caller.locator(`[data-testid=num-${num}]`).click();
  await expect(searcher.getByTestId('find-target')).toContainText(num!);

  if (boxes > 0) {
    // wait until the caller's own UI has entered the fill phase (state may lag
    // a round-trip behind under latency) before pressing
    await expect(caller.getByTestId('banner')).toContainText('HOLD', { timeout: 8000 });
    await fillBoxes(caller, boxes);

    // did the caller fill the grid mid-search (instant win)?
    if (await caller.getByTestId('end-screen').isVisible().catch(() => false)) return false;
  }

  // searcher finds the number and slaps the bell (force: the armed bell pulses)
  await searcher.locator(`[data-testid=num-${num}]`).click();
  await searcher.getByTestId('bell').click({ force: true });
  return true;
}

async function circledCount(page: Page) {
  return page.locator('.sheet-num.circled').count();
}

async function ended(host: Page, guest: Page) {
  return (
    (await host.getByTestId('end-screen').isVisible().catch(() => false)) ||
    (await guest.getByTestId('end-screen').isVisible().catch(() => false))
  );
}

/** Play rounds until the match ends. */
async function playToWin(host: Page, guest: Page) {
  let guard = 0;
  while (guard++ < 40) {
    if (await ended(host, guest)) break;
    const r = await rolesNow(host, guest);
    const cont = await playRound(r.caller, r.searcher, 4);
    if (!cont) break;
  }
  await expect(host.getByTestId('end-screen')).toBeVisible();
  await expect(guest.getByTestId('end-screen')).toBeVisible();
}

test('relay: full two-player match — calling, finding, filling, alternation, win', async ({
  browser,
}) => {
  const { host, guest } = await createMatch(browser);

  // round 1: caller earns one box per cell they hold-fill
  const { caller, searcher } = await rolesNow(host, guest);
  const before = await gridCount(caller);
  await playRound(caller, searcher, 4); // four cell-holds -> ~4 boxes
  await expect
    .poll(async () => gridCount(caller))
    .toBeGreaterThan(before);
  const earned = await gridCount(caller);
  expect(earned).toBeGreaterThanOrEqual(3);
  expect(earned).toBeLessThanOrEqual(6);

  // alternation: the previous searcher is now the caller
  await expect(searcher.getByTestId('banner')).toContainText('YOUR TURN');

  // play on until someone wins
  await playToWin(host, guest);
  const hostEnd = host.getByTestId('end-screen');
  const guestEnd = guest.getByTestId('end-screen');
  const hostTitle = (await host.locator('.end-title').textContent()) ?? '';
  const guestTitle = (await guest.locator('.end-title').textContent()) ?? '';
  const wins = [hostTitle, guestTitle].filter((t) => t.includes('win')).length;
  expect(wins).toBe(1);
});

async function seriesSum(page: Page) {
  const nums = await page.getByTestId('series-tally').locator('.series-num').allTextContents();
  return nums.reduce((a, n) => a + Number(n), 0);
}

test('relay: rematch keeps a running series tally', async ({ browser }) => {
  const { host, guest } = await createMatch(browser);

  await playToWin(host, guest);
  // one game played -> the two tally numbers sum to 1
  expect(await seriesSum(host)).toBe(1);
  expect(await seriesSum(guest)).toBe(1);

  // host starts a rematch
  await host.getByTestId('play-again').click();
  await expect(host.getByTestId('end-screen')).toBeHidden();
  await expect(guest.getByTestId('end-screen')).toBeHidden();

  await playToWin(host, guest);
  // two games played -> tally sums to 2 (and stays consistent on both peers)
  expect(await seriesSum(host)).toBe(2);
  expect(await seriesSum(guest)).toBe(2);
});

test('relay: wrong number does not arm the bell', async ({ browser }) => {
  const { host, guest } = await createMatch(browser);
  const { caller, searcher } = await rolesNow(host, guest);

  const num = (await caller
    .locator('.sheet-num:not([disabled])')
    .first()
    .getAttribute('data-value'))!;
  await caller.locator(`[data-testid=num-${num}]`).click();
  await expect(searcher.getByTestId('find-target')).toContainText(num);

  // click a DIFFERENT number on the searcher's sheet
  const wrong = await searcher
    .locator(`.sheet-num:not([disabled])`)
    .filter({ hasNotText: num })
    .first()
    .getAttribute('data-value');
  if (wrong) await searcher.locator(`[data-testid=num-${wrong}]`).click();

  await expect(searcher.getByTestId('bell')).toBeDisabled();

  // clicking the correct one arms it
  await searcher.locator(`[data-testid=num-${num}]`).click();
  await expect(searcher.getByTestId('bell')).toBeEnabled();
});

test('relay: grace expiry ends the match when a peer leaves', async ({ browser }) => {
  const { host, guest, guestCtx } = await createMatch(browser);
  await rolesNow(host, guest); // ensure playing

  await guestCtx.close(); // guest drops

  // host notices and, after the (test-shortened) grace, ends
  await expect(host.getByTestId('status')).toContainText(/reconnect|ended|left/i, {
    timeout: 8000,
  });
  await expect(host.getByTestId('status')).toContainText(/left|ended/i, { timeout: 8000 });
});

test('p2p: full match plays over a real WebRTC data channel', async ({ browser }) => {
  const { host, guest } = await createMatch(browser, { transport: 'p2p' });
  // confirm we are genuinely on the P2P path, not relay
  await expect(host.locator('.pill.p2p')).toBeVisible();
  await expect(guest.locator('.pill.p2p')).toBeVisible();

  // a normal round produces boxes (exercises clock sync over the data channel)
  const { caller, searcher } = await rolesNow(host, guest);
  const before = await gridCount(caller);
  await playRound(caller, searcher, 4);
  await expect.poll(async () => gridCount(caller)).toBeGreaterThan(before);

  await playToWin(host, guest);
  const hostWin = (await host.locator('.end-title').textContent())!.includes('win');
  const guestWin = (await guest.locator('.end-title').textContent())!.includes('win');
  expect([hostWin, guestWin].filter(Boolean)).toHaveLength(1);
});

for (const first of ['host', 'guest'] as const) {
  test(`relay: ${first} calls first (exercises the ${first}-as-caller path)`, async ({
    browser,
  }) => {
    const { host, guest } = await createMatch(browser, { first });
    // the forced first caller shows the YOUR TURN banner
    const expected = first === 'host' ? host : guest;
    const other = first === 'host' ? guest : host;
    await expect(expected.getByTestId('banner')).toContainText('YOUR TURN');
    await expect(other.getByTestId('banner')).toContainText('choosing');

    // play the round through that caller and confirm boxes are awarded
    const before = await gridCount(expected);
    await playRound(expected, other, 4);
    await expect.poll(async () => gridCount(expected)).toBeGreaterThan(before);
    // and roles alternate afterwards
    await expect(other.getByTestId('banner')).toContainText('YOUR TURN');
  });
}

test('relay: filling the last box mid-search wins instantly without a bell', async ({ browser }) => {
  // grid 2x2 = 4 boxes at 120ms/box -> filling all four cells wins outright
  const { host, guest } = await createMatch(browser, { first: 'host', grid: 2, rate: 120 });
  await expect(host.getByTestId('banner')).toContainText('YOUR TURN');

  const num = (await host
    .locator('.sheet-num:not([disabled])')
    .first()
    .getAttribute('data-value'))!;
  await host.locator(`[data-testid=num-${num}]`).click();

  // host fills all four boxes one-by-one — the 4th caps the grid and wins, no bell
  await fillBoxes(host, 4);

  await expect(host.getByTestId('end-screen')).toBeVisible();
  await expect(guest.getByTestId('end-screen')).toBeVisible();
  expect((await host.locator('.end-title').textContent())!).toContain('win');
});

test('latency: relay match stays fair under ~200ms per-message delay', async ({ browser }) => {
  test.setTimeout(60000);
  // real added latency on game traffic (relayDelay) + emulated network (CDP).
  // Symmetric delay => clock-sync offset ~0 => box award must remain fair.
  const { host, guest } = await createMatch(browser, {
    transport: 'relay',
    relayDelay: 200,
    throttleMs: 100,
    grid: 3,
    rate: 150,
    count: 12,
  });

  const { caller, searcher } = await rolesNow(host, guest);
  const before = await gridCount(caller);
  await playRound(caller, searcher, 6); // six cell-holds -> 6 boxes (fair)

  // authoritative count settles after the lagged round-trip; poll for it
  await expect.poll(async () => gridCount(caller), { timeout: 8000 }).toBeGreaterThan(before);
  const earned = (await gridCount(caller)) - before;
  // latency must not distort the award beyond floor quantization (±1)
  expect(earned).toBeGreaterThanOrEqual(5);
  expect(earned).toBeLessThanOrEqual(7);

  // and the whole match still completes with exactly one winner
  await playToWin(host, guest);
  const hostWin = (await host.locator('.end-title').textContent())!.includes('win');
  const guestWin = (await guest.locator('.end-title').textContent())!.includes('win');
  expect([hostWin, guestWin].filter(Boolean)).toHaveLength(1);
});

test('latency: P2P connects and plays under emulated network conditions', async ({ browser }) => {
  test.setTimeout(60000);
  const { host, guest } = await createMatch(browser, {
    transport: 'p2p',
    throttleMs: 150,
    grid: 3,
    rate: 150,
    count: 12,
  });
  // the WebRTC data channel still establishes despite the emulated latency
  await expect(host.locator('.pill.p2p')).toBeVisible({ timeout: 25000 });
  await expect(guest.locator('.pill.p2p')).toBeVisible({ timeout: 25000 });

  // and a round plays through to award boxes
  const { caller, searcher } = await rolesNow(host, guest);
  const before = await gridCount(caller);
  await playRound(caller, searcher, 4);
  await expect.poll(async () => gridCount(caller), { timeout: 8000 }).toBeGreaterThan(before);
});

test('relay: sheet regenerates when every number is circled', async ({ browser }) => {
  // 3 numbers, effectively no filling (huge rate) so nobody wins
  const { host, guest } = await createMatch(browser, {
    first: 'host',
    count: 3,
    grid: 3,
    rate: 100000,
  });

  await expect(host.locator('.sheet-num')).toHaveCount(3);

  let r = await rolesNow(host, guest);
  await playRound(r.caller, r.searcher, 0);
  await expect.poll(() => circledCount(host)).toBe(1);

  r = await rolesNow(host, guest);
  await playRound(r.caller, r.searcher, 0);
  await expect.poll(() => circledCount(host)).toBe(2);

  // circling the last number exhausts the sheet -> a fresh one is generated
  r = await rolesNow(host, guest);
  await playRound(r.caller, r.searcher, 0);
  await expect.poll(() => circledCount(host)).toBe(0);
  await expect(host.locator('.sheet-num')).toHaveCount(3);
  // and the guest sees the same fresh sheet
  await expect.poll(() => circledCount(guest)).toBe(0);
});

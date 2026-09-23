import { test, expect, Page, BrowserContext } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * Visual harness (not an assertion test): drives a real two-player match and
 * screenshots every meaningful UI state for both roles at the approved 390×844
 * reference size. Set SHOT_DIR to choose the output folder.
 */
const DIR = process.env.SHOT_DIR || 'screenshots/after';
mkdirSync(DIR, { recursive: true });

function hostUrl() {
  // host always calls first; slow-ish fill so the hold state is screenshottable
  // Match the approved gameplay frame and the lobby's default Normal preset.
  return '/?transport=relay&first=host&grid=10&rate=350&count=30';
}

async function createMatch(browser: BrowserContext['browser']) {
  const hostCtx = await browser!.newContext();
  const guestCtx = await browser!.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  await host.goto(hostUrl());
  await host.evaluate(() => document.fonts.ready);
  // capture the lobby + waiting (creation) screens before connecting
  await host.screenshot({ path: `${DIR}/00-lobby.png` });
  await host.getByTestId('create').click();
  await expect(host.getByTestId('room-code')).toBeVisible();
  await host.screenshot({ path: `${DIR}/01-waiting.png` });
  const code = (await host.getByTestId('room-code').textContent())!.trim();

  await guest.goto(`/?transport=relay&room=${code}`);
  await expect(host.getByTestId('board')).toBeVisible({ timeout: 20000 });
  await expect(guest.getByTestId('board')).toBeVisible({ timeout: 20000 });
  await Promise.all([
    host.evaluate(() => document.fonts.ready),
    guest.evaluate(() => document.fonts.ready),
  ]);
  return { hostCtx, guestCtx, host, guest };
}

async function tapNumber(page: Page, value: string) {
  const button = page.getByTestId(`num-${value}`);
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  const bounds = await button.boundingBox();
  if (!bounds) throw new Error(`number ${value} has no visible hit area`);
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
}

test('capture UI states', async ({ browser }) => {
  test.setTimeout(60000);
  const { host, guest } = await createMatch(browser);

  // host is the caller (first=host). guest is the searcher.
  await expect(host.getByTestId('banner')).toContainText('YOUR TURN');
  await expect(host.getByTestId('my-grid').locator('.box')).toHaveCount(100);
  await expect(host.getByTestId('sheet').locator('.sheet-num')).toHaveCount(30);
  const playerGridBounds = await host.getByTestId('my-grid').boundingBox();
  expect(playerGridBounds).toBeTruthy();
  expect(playerGridBounds!.y + playerGridBounds!.height).toBeLessThanOrEqual(844);
  await host.screenshot({ path: `${DIR}/10-caller-pick.png` });
  await guest.screenshot({ path: `${DIR}/11-searcher-wait.png` });

  // caller calls a number
  const num = (await host
    .locator('.sheet-num:not([disabled])')
    .first()
    .getAttribute('data-value'))!;
  await tapNumber(host, num);

  // searcher now hunting (number shown, bell not yet armed)
  await expect(guest.getByTestId('find-target')).toContainText(num);
  await expect(guest.locator('.sheet-num.circled')).toHaveCount(0);
  await guest.screenshot({ path: `${DIR}/12-searcher-hunt.png` });

  // caller presses & holds a single box -> capture it mid-ink (rate=350ms)
  await expect(host.getByTestId('banner')).toContainText('HOLD');
  const cell = host.locator('.grid-wrap.mine .box:not(.x)').first();
  const box = (await cell.boundingBox())!;
  await host.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await host.mouse.down();
  await host.waitForTimeout(180); // ~half a cell inked -> partial X visible
  await host.screenshot({ path: `${DIR}/13-caller-holding.png` });
  await host.mouse.up();

  // searcher finds the number -> bell armed
  await tapNumber(guest, num);
  await expect(guest.getByTestId('bell')).toBeEnabled();
  await expect(guest.locator(`.sheet-num.circled[data-value="${num}"]`)).toBeVisible();
  await guest.screenshot({ path: `${DIR}/14-searcher-armed.png` });

  await host.screenshot({ path: `${DIR}/15-caller-after.png` });
});

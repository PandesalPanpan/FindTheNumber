import { test, expect, Page, BrowserContext } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * Visual harness (not an assertion test): drives a real two-player match and
 * screenshots every meaningful UI state for both roles. Set SHOT_DIR to choose
 * the output folder, e.g. SHOT_DIR=screenshots/before npx playwright test shots.
 */
const DIR = process.env.SHOT_DIR || 'screenshots/after';
mkdirSync(DIR, { recursive: true });

function hostUrl() {
  // host always calls first; slow-ish fill so the hold state is screenshottable
  return '/?transport=relay&first=host&grid=4&rate=350&count=16';
}

async function createMatch(browser: BrowserContext['browser']) {
  const hostCtx = await browser!.newContext();
  const guestCtx = await browser!.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  await host.goto(hostUrl());
  // capture the lobby + waiting (creation) screens before connecting
  await host.screenshot({ path: `${DIR}/00-lobby.png` });
  await host.getByTestId('create').click();
  await expect(host.getByTestId('room-code')).toBeVisible();
  await host.screenshot({ path: `${DIR}/01-waiting.png` });
  const code = (await host.getByTestId('room-code').textContent())!.trim();

  await guest.goto(`/?transport=relay&room=${code}`);
  await expect(host.getByTestId('board')).toBeVisible({ timeout: 20000 });
  await expect(guest.getByTestId('board')).toBeVisible({ timeout: 20000 });
  return { hostCtx, guestCtx, host, guest };
}

test('capture UI states', async ({ browser }) => {
  test.setTimeout(60000);
  const { host, guest } = await createMatch(browser);

  // host is the caller (first=host). guest is the searcher.
  await expect(host.getByTestId('banner')).toContainText('YOUR TURN');
  await host.screenshot({ path: `${DIR}/10-caller-pick.png` });
  await guest.screenshot({ path: `${DIR}/11-searcher-wait.png` });

  // caller calls a number
  const num = (await host
    .locator('.sheet-num:not([disabled])')
    .first()
    .getAttribute('data-value'))!;
  await host.locator(`[data-testid=num-${num}]`).click();

  // searcher now hunting (number shown, bell not yet armed)
  await expect(guest.getByTestId('find-target')).toContainText(num);
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
  await guest.locator(`[data-testid=num-${num}]`).click();
  await expect(guest.getByTestId('bell')).toBeEnabled();
  await guest.screenshot({ path: `${DIR}/14-searcher-armed.png` });

  await host.screenshot({ path: `${DIR}/15-caller-after.png` });
});

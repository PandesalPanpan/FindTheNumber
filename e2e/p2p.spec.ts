import { test, expect } from '@playwright/test';

// Smoke test: with the default transport (no ?transport=relay), the WebRTC
// DataChannel should actually establish on loopback. No timing assertions.
test('p2p: WebRTC data channel establishes on loopback', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  await host.goto('/?grid=3&rate=200&count=12');
  await host.getByTestId('create').click();
  await expect(host.getByTestId('room-code')).toBeVisible();
  const code = (await host.getByTestId('room-code').textContent())!.trim();

  await guest.goto(`/?room=${code}`);

  // both reach the board
  await expect(host.getByTestId('board')).toBeVisible({ timeout: 20000 });
  await expect(guest.getByTestId('board')).toBeVisible({ timeout: 20000 });

  // and the transport pill reports P2P (not relay) on both sides
  await expect(host.locator('.pill.p2p')).toBeVisible({ timeout: 20000 });
  await expect(guest.locator('.pill.p2p')).toBeVisible({ timeout: 20000 });

  await hostCtx.close();
  await guestCtx.close();
});

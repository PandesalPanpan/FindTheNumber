import { test, expect } from '@playwright/test';

// Guards the reported bug: on non-secure origins (LAN IP / plain http)
// navigator.clipboard is undefined, so the old `clipboard?.writeText(...).then()`
// silently did nothing. The synchronous execCommand fallback must fire within
// the click gesture and confirm with "Copied".
test('copy works when the async clipboard API is unavailable', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  });
  await page.goto('/?transport=relay&grid=4&rate=350');
  await page.getByTestId('create').click();
  await expect(page.getByTestId('room-code')).toBeVisible();

  // locate by class (the accessible name changes to "Copied" after the click)
  const btn = page.locator('button.big-btn.join');
  await btn.click();
  await expect(btn).toContainText('Copied', { timeout: 3000 });
  await ctx.close();
});

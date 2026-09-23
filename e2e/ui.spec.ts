import { test, expect } from '@playwright/test';

test('lobby presets, advanced settings, create, and manual join retain live game config', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  await host.goto('/?transport=relay');
  const trailer = host.getByTestId('trailer-panel');
  await trailer.locator('summary').click();
  await expect(trailer.getByTestId('trailer')).toBeVisible();
  const trailerMute = trailer.getByTestId('trailer-mute');
  await expect(trailerMute).toHaveAttribute('aria-pressed', 'false');
  await trailerMute.click();
  await expect(trailerMute).toHaveAttribute('aria-pressed', 'true');
  await expect(trailerMute).toContainText('Sound on');
  await trailer.locator('summary').click();
  await expect(trailer.getByTestId('trailer')).toHaveCount(0);

  await expect(host.getByTestId('preset-normal')).toHaveAttribute('aria-pressed', 'true');
  await host.getByTestId('preset-quick').click();
  await expect(host.getByTestId('preset-quick')).toHaveAttribute('aria-pressed', 'true');
  await expect(host.getByTestId('config-summary')).toContainText('6×6');
  await host.getByTestId('preset-normal').click();
  await expect(host.getByTestId('config-summary')).toContainText('10×10');
  await host.getByTestId('preset-marathon').click();
  await expect(host.getByTestId('config-summary')).toContainText('12×12');

  await host.getByTestId('advanced-toggle').click();
  await expect(host.getByTestId('adv-grid-size')).toHaveValue('12');
  await host.getByTestId('adv-grid-size').fill('7');
  await host.getByTestId('adv-sheet-count').fill('17');
  await host.getByTestId('adv-fill-rate').fill('90');
  await expect(host.getByTestId('config-summary')).toContainText('7×7');

  await host.getByTestId('create').click();
  await expect(host.getByTestId('waiting')).toBeVisible();
  const code = (await host.getByTestId('room-code').textContent())!.trim();
  expect(code).toMatch(/^[A-Z0-9]{5}$/);
  await expect(host.getByTestId('invite-link')).toHaveValue(new RegExp(`room=${code}`));

  await guest.goto('/?transport=relay');
  await guest.getByTestId('code-input').fill(code.toLowerCase());
  await guest.getByTestId('join').click();
  await expect(host.getByTestId('board')).toBeVisible({ timeout: 20000 });
  await expect(guest.getByTestId('board')).toBeVisible({ timeout: 20000 });
  await expect(host.getByTestId('my-grid').locator('.box')).toHaveCount(49);
  await expect(host.getByTestId('sheet').locator('.sheet-num')).toHaveCount(17);
  await expect(host.getByTestId('opp-grid').locator('.opponent-mini-cell')).toHaveCount(49);

  const handwriting = await host.locator('.sheet-num').evaluateAll((numbers) => numbers.map((node) => {
    const button = node as HTMLButtonElement;
    const transform = button.style.transform;
    return {
      value: button.dataset.value,
      font: button.dataset.handFont,
      family: button.style.fontFamily,
      size: button.style.fontSize,
      left: button.style.left,
      top: button.style.top,
      rotation: Number(transform.match(/rotate\((-?\d+(?:\.\d+)?)deg\)/)?.[1]),
      border: getComputedStyle(button).borderTopWidth,
      background: getComputedStyle(button).backgroundColor,
    };
  }));
  const guestHandwriting = await guest.locator('.sheet-num').evaluateAll((numbers) => numbers.map((node) => {
    const button = node as HTMLButtonElement;
    return {
      value: button.dataset.value,
      font: button.dataset.handFont,
      family: button.style.fontFamily,
      size: button.style.fontSize,
      left: button.style.left,
      top: button.style.top,
      rotation: Number(button.style.transform.match(/rotate\((-?\d+(?:\.\d+)?)deg\)/)?.[1]),
      border: getComputedStyle(button).borderTopWidth,
      background: getComputedStyle(button).backgroundColor,
    };
  }));
  expect(handwriting).toEqual(guestHandwriting);
  expect(handwriting.every((number) => number.rotation >= 173 && number.rotation <= 187)).toBe(true);
  expect(handwriting.every((number) => number.border === '0px' && number.background === 'rgba(0, 0, 0, 0)')).toBe(true);

  const fonts = await host.evaluate(async () => {
    const families = ['Caveat', 'Patrick Hand', 'Schoolbell', 'Gloria Hallelujah', 'Rock Salt', 'Permanent Marker'];
    const loaded = await Promise.all(families.map((family) => document.fonts.load(`22px "${family}"`)));
    return loaded.map((faces) => faces.some((face) => face.status === 'loaded'));
  });
  expect(fonts.every(Boolean), 'all six handwritten web fonts should load').toBe(true);

  for (const width of [320, 390, 430, 768, 1280]) {
    await host.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    const dimensions = await host.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      grid: document.querySelector<HTMLElement>('[data-testid="my-grid"]')?.getBoundingClientRect().width ?? 0,
    }));
    expect(dimensions.document, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(width);
    expect(dimensions.grid, `player grid missing at ${width}px`).toBeGreaterThan(0);
  }

  await hostContext.close();
  await guestContext.close();
});

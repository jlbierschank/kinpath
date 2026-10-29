// Dark mode: follows the phone, can be set in Settings, and remembers the choice.
// Start the server (KINPATH_DEV_LOGIN=1) and the app on web (EXPO_PUBLIC_DEMO=1), then run with Playwright.
const { chromium } = require('playwright');
const APP = process.env.APP ?? 'http://localhost:8081';
(async () => {
  const b = await chromium.launch();
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  const bg = (p) => p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const DARK = 'rgb(35, 27, 23)', LIGHT = 'rgb(246, 241, 232)';
  const GREETING_LIGHT = 'rgb(46, 33, 28)'; // light-mode espresso

  const p = await b.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  await p.goto(APP + '/'); await p.waitForTimeout(1500);
  ok(await bg(p) === DARK, 'Phone in dark mode: the app opens dark');
  await p.locator('[data-testid="pick-Alex Rivera"]').click();
  await p.locator('[data-testid="solo-tab-more"]').click();
  await p.locator('[data-testid="appearance-light"]').click(); await p.waitForTimeout(300);
  ok(await bg(p) === LIGHT, 'Choosing Light in Settings switches right away');
  // Every screen repaints, not only the one she's on (tabs stay open in the background).
  const sceneBg = () => p.locator('[data-testid="calshare"]').evaluate((e) => getComputedStyle(e).backgroundColor);
  ok(await sceneBg() === 'rgb(255, 252, 247)', 'The You screen itself turns light');
  await p.locator('[data-testid="solo-tab-today"]').click(); await p.waitForTimeout(300);
  ok(await p.locator('[data-testid="greeting"]').evaluate((e) => getComputedStyle(e).color) === GREETING_LIGHT, 'Today, open in the background, is light too');
  await p.locator('[data-testid="solo-tab-more"]').click();
  await p.reload(); await p.waitForTimeout(1500);
  ok(await bg(p) === LIGHT, 'The choice is remembered');
  await p.locator('[data-testid="pick-Alex Rivera"]').click();
  await p.locator('[data-testid="solo-tab-more"]').click();
  await p.locator('[data-testid="appearance-system"]').click(); await p.waitForTimeout(300);
  ok(await bg(p) === DARK, 'Match phone goes back to dark');
  await p.close();

  const q = await b.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
  await q.goto(APP + '/'); await q.waitForTimeout(1500);
  ok(await bg(q) === LIGHT, 'Phone in light mode: the app opens light');
  await b.close();
})();

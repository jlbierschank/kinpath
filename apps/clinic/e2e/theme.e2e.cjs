// The clinic workspace looks like Pumpkin: brand fonts, logo, and light or dark that's remembered.
// Start the app first (pnpm dev:clinic), then: node apps/clinic/e2e/theme.e2e.cjs
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  await p.goto('http://localhost:3000/'); await p.locator('form button', { hasText: 'Maria Lopez' }).click(); await p.waitForURL(/nurse/); await p.waitForLoadState('networkidle');
  const font = await p.evaluate(() => getComputedStyle(document.querySelector('h1')).fontFamily);
  ok(/Bricolage/.test(font), 'Headlines use Bricolage Grotesque, like the app');
  ok(await p.evaluate(() => document.fonts.check('600 20px "Bricolage Grotesque"')), 'The brand font loads');
  ok(await p.locator('.topnav .logo-light').isVisible() && /Bayside Fertility/.test(await p.locator('.topnav .brand').innerText()), 'Top bar shows the Pumpkin logo and the clinic name');
  ok(await p.locator('.topnav a.on', { hasText: 'Queue' }).count() === 1, 'The current page is marked in the top bar');
  const bgLight = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await p.click('[data-testid="account-menu"]'); await p.click('[data-testid="theme-dark"]'); await p.waitForTimeout(300);
  const bgDark = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(bgLight !== bgDark && await p.locator('.topnav .logo-dark').isVisible(), 'Dark turns the page dark, with the on-dark logo');
  await p.reload(); await p.waitForLoadState('networkidle');
  ok(await p.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'dark', 'Dark is remembered after reload');
  await p.click('[data-testid="account-menu"]'); await p.click('[data-testid="theme-system"]'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => document.documentElement.getAttribute('data-theme')) === null, 'Match computer goes back to the computer setting');
  const d = await b.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
  await d.goto('http://localhost:3000/');
  ok(await d.evaluate(() => getComputedStyle(document.body).backgroundColor) !== bgLight, 'A computer set to dark gets dark without choosing');
  ok(errs.length === 0, 'No page errors');
  await b.close();
})();

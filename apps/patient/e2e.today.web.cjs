// Today: the "Right now" card, Edit Today, swipe to log, refill countdown, meds calendar, date pickers.
// Start the server (KINPATH_DEV_LOGIN=1) and the app on web (EXPO_PUBLIC_DEMO=1), then run with Playwright.
const { chromium } = require('playwright');
const SERVER = 'http://localhost:3000', APP = process.env.APP ?? 'http://localhost:8081';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); // a phone: touch
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  const byId = (id) => p.locator(`[data-testid="${id}"]`);
  const sees = async (s, t = 10000) => { try { await p.getByText(s, { exact: false }).filter({ visible: true }).first().waitFor({ timeout: t }); return true; } catch { return false; } };
  const D = require('os').tmpdir() + '/kinpath-phone-shots/'; require('fs').mkdirSync(D, { recursive: true });
  { const w = await b.newPage(); await w.goto(SERVER + '/'); await w.click('button:has-text("Reset demo data")'); await w.waitForTimeout(1500); await w.close(); }

  await p.goto(APP + '/');
  await byId('pick-Alex Rivera').click();
  await byId('greeting').waitFor();
  ok(await byId('now').count() === 1, 'Today leads with a "Right now" card');
  const why = await byId('now-why').innerText();
  ok(/IT'S TIME|IN \d|NOT LOGGED|WAITING FOR YOU TO CHECK/.test(why), `It says why: ${why}`);
  await p.screenshot({ path: D + 'today-1-now.png' });

  // Edit Today: hide "Coming up", then go back to Pumpkin's order.
  ok(await byId('tile-coming').count() === 1, 'Coming up shows by default');
  await byId('edit-today').click();
  ok(await byId('show-meds').count() === 0 && await sees('Always shown'), "Tonight's meds can't be hidden");
  await byId('show-coming').click();
  await byId('edit-save').click();
  ok(await sees('Today is set up your way.'), 'Saved');
  ok(await byId('tile-coming').count() === 0, 'Coming up is hidden');
  await p.reload(); await byId('pick-Alex Rivera').click(); await byId('greeting').waitFor();
  ok(await byId('tile-coming').count() === 0, 'The layout is remembered on this device');
  await byId('edit-today').click(); await byId('edit-reset').click();
  ok(await byId('tile-coming').count() === 1, "Back to Pumpkin's order");

  // Swipe right on tonight's dose to log it.
  const row = p.locator('[data-testid^="swipe-"]').first();
  if (await row.count()) {
    const box = await row.boundingBox();
    await p.mouse.move(box.x + 30, box.y + box.height / 2); await p.mouse.down();
    for (let i = 1; i <= 10; i++) await p.mouse.move(box.x + 30 + i * 18, box.y + box.height / 2);
    await p.mouse.up();
    ok(await sees('Done', 8000), 'Swiping right logs the dose');
  } else ok(false, 'A dose row to swipe');

  // Refill countdown: count what she has; Today warns when it's about to run out.
  await byId('solo-tab-record').click();
  await byId('supply').waitFor();
  await p.locator('[data-testid^="count-"]').first().click();
  await byId('supply-count').fill('1'); await byId('supply-save').click();
  ok(await sees('1 left'), 'Record shows doses left');
  await byId('solo-tab-today').click();
  ok(await byId('refill-tile').count() === 1 || (await byId('now-why').innerText()).includes('RUNNING LOW'), 'Today warns before it runs out');
  await p.screenshot({ path: D + 'today-2-refill.png', fullPage: true });

  // A meds calendar becomes the whole schedule to check.
  await byId('solo-tab-add').click(); await byId('menu-type').click(); await byId('type-more').filter({ visible: true }).click();
  await byId('sample-protocol-calendar').click();
  await byId('schedule-summary').waitFor({ timeout: 15000 });
  ok(/\d+ medication steps/.test(await byId('schedule-summary').innerText()), 'Schedule overview of every step');
  ok(await sees('Gonal-f 150 IU'), 'The dose change is its own step');
  await p.screenshot({ path: D + 'today-3-calendar.png', fullPage: true });

  // Dates use a real picker, shown as "Wed, Oct 29".
  const start = byId('f-start').first();
  ok(await start.getAttribute('type') === 'date', 'First day is a date picker');
  await start.fill('2026-11-04');
  ok(await sees('Wed, Nov 4'), 'Shows the date in words');
  ok(errs.length === 0, 'No page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
})();

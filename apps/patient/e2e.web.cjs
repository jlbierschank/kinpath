// Web check of the phone app. Start the server (pnpm dev:clinic) and the app on web (pnpm dev:patient, press w), then run with Playwright installed. Adjust the URL to the port Expo prints.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  const D = require('os').tmpdir() + '/kinpath-phone-shots/'; require('fs').mkdirSync(D, { recursive: true });
  const shot = n => p.screenshot({ path: D + n + '.png' });
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  const byId = id => p.locator(`[data-testid="${id}"]`);
  const text = s => p.getByText(s, { exact: false });

  { const w = await b.newPage(); await w.goto('http://localhost:3000/'); await w.click('button:has-text("Reset demo data")'); await w.waitForTimeout(1500); await w.close(); }
  await p.goto('http://localhost:8081/');
  await byId('pick-Maya Torres').click();
  await text('Up next').waitFor({ timeout: 15000 });
  await p.waitForTimeout(500);
  await shot('1-home');
  ok(await text('Others ask this on day 6').count() === 1, 'Home matches demo: "Others ask this on day 6" chips');
  ok(await text('3 injections tonight').count() === 1, 'Dark card shows tonight’s 3 injections');
  ok(await p.locator('svg').count() > 0, 'Dotted path renders');

  await byId('start-walkthrough').click();
  await byId('walk-med').waitFor();
  await byId('step-text').waitFor({ timeout: 10000 });
  await shot('2-walk');
  ok((await byId('step-text').innerText()).startsWith('Wash your hands'), 'Walkthrough shows nurse-approved steps');
  await byId('log-dose').click();
  await text('First one done').waitFor({ timeout: 10000 });
  await byId('step-text').waitFor({ timeout: 10000 });
  await shot('3-first-done');
  ok(true, '"First one done" moment');
  await byId('log-dose').click(); await p.waitForTimeout(300);
  await byId('step-text').waitFor({ timeout: 10000 });
  await byId('log-dose').click();
  await byId('walk-done').waitFor({ timeout: 10000 });
  ok(await text('3 of 3 logged').count() === 1, 'All three logged');
  await p.getByText('Back to today').click();
  await text('All set for tonight').waitFor({ timeout: 10000 });
  await shot('4-all-set');
  ok(true, 'Home shows "All set for tonight"');

  await byId('chip-missed').click();
  await byId('missed-note').fill("Also I'm bloated and short of breath");
  await byId('missed-it').click();
  await byId('urgent-title').waitFor({ timeout: 10000 });
  await shot('5-urgent');
  ok(true, 'Urgent note goes to the safety screen');
  await p.getByText('Back to today').click();

  await byId('tab-team').click();
  await byId('message').fill('Can I have coffee during stims?');
  await byId('message-send').click();
  await text('Waiting for your nurse').first().waitFor({ timeout: 10000 });
  await shot('6-team');
  ok(true, 'Message shows as waiting for the nurse');

  await byId('tab-record').click(); await text('Your record').waitFor(); await shot('7-record');
  await byId('avatar').click(); await p.getByText('Settings', { exact: true }).waitFor(); await shot('8-settings');
  ok(true, 'Record and Settings open');

  await p.goto('http://localhost:8081/');
  await byId('pick-Priya Shah').click();
  await text('Hoy').first().waitFor({ timeout: 15000 });
  ok(await text('Otras personas preguntan esto').count() >= 1, 'Priya sees Spanish');
  await shot('9-priya');
  console.log('errors:', JSON.stringify(errs));
  await b.close();
})();

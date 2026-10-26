// Web check of the phone app. Start the server (pnpm dev:clinic) and the app on web (pnpm dev:patient, press w), then run with Playwright installed. Adjust the URL to the port Expo prints.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  const D = require('os').tmpdir() + '/kinpath-phone-shots/'; require('fs').mkdirSync(D, { recursive: true });
  const shot = n => p.screenshot({ path: D + n + '.png', fullPage: true });
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  const byId = id => p.locator(`[data-testid="${id}"]`);
  const text = s => p.getByText(s, { exact: false });

  await p.goto('http://localhost:8081/');
  await byId('pick-Maya Torres').click();
  await text('Next injections').waitFor({ timeout: 15000 });
  await shot('1-today');
  ok(await text("isn't logged").count() >= 1, 'Maya sees last night’s unlogged Gonal-f');
  ok(await text('Cetrotide, Gonal-f, Menopur').count() === 1, 'Tonight’s three injections are grouped');

  // Walkthrough
  await byId('start-walkthrough').click();
  await byId('step-text').waitFor();
  const first = await byId('step-text').innerText();
  ok(first.startsWith('Wash your hands'), 'Walkthrough starts with the nurse-approved first step');
  await shot('2-walk-step1');
  for (let i = 0; i < 5; i++) await byId('next-step').click();
  await byId('log-dose').click();
  await text('First one done').waitFor({ timeout: 10000 });
  ok(true, '"First one done" moment after the first injection');
  await shot('3-first-done');
  for (let m = 0; m < 2; m++) { await byId('step-text').waitFor(); for (let i = 0; i < 5; i++) await byId('next-step').click(); await byId('log-dose').click(); }
  await text('All done for tonight').waitFor({ timeout: 10000 });
  ok(await text('You logged 3 of 3').count() === 1, 'All three logged');
  await p.getByText('Back to today').click();
  await text('Recent doses').waitFor();

  // Missed dose with an urgent note
  await byId('missed-note').fill("Also I'm bloated and short of breath");
  await byId('missed-it').click();
  await byId('urgent-title').waitFor({ timeout: 10000 });
  ok((await byId('urgent-title').innerText()).includes('needs a nurse now'), 'Urgent note goes to the safety screen, not the AI');
  await shot('4-urgent');
  await p.getByText('Back to today').click();

  // Ordinary message
  await byId('tab-messages').click();
  await byId('message-text').fill('Can I have coffee during stims?');
  await byId('send-message').click();
  await text('Recent doses').waitFor({ timeout: 10000 });
  await byId('tab-messages').click();
  ok(await text('Waiting for your nurse').count() >= 1, 'Question shows as waiting for the nurse');
  await shot('5-messages');

  // Settings: privacy toggle
  await byId('tab-settings').click();
  await text('Reminders work in the phone app').waitFor();
  ok(true, 'Web build explains reminders need the phone');
  await shot('6-settings');

  // Spanish patient
  await p.goto('http://localhost:8081/');
  await byId('pick-Priya Shah').click();
  await text('Hoy').first().waitFor({ timeout: 15000 });
  ok(await text('Las enfermeras responden').count() >= 1, 'Priya sees the app in Spanish');
  await shot('7-priya-es');

  console.log('errors:', JSON.stringify(errs));
  await b.close();
})();

// Web check of the partner side. Start the server (pnpm dev:clinic) and the app on web (pnpm dev:patient, press w), then run with Playwright installed.
const { chromium } = require('playwright');
const APP = process.env.APP_URL ?? (process.env.APP ? process.env.APP + '/' : 'http://localhost:8081/');
const SERVER = process.env.SERVER_URL ?? 'http://localhost:3000/';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const D = require('os').tmpdir() + '/kinpath-partner-shots/'; require('fs').mkdirSync(D, { recursive: true });
  const shot = n => p.screenshot({ path: D + n + '.png', fullPage: true });
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  const byId = id => p.locator(`[data-testid="${id}"]`);
  const text = s => p.getByText(s, { exact: false });
  const sees = s => text(s).filter({ visible: true }).first().waitFor({ timeout: 10000 }).then(() => true, () => false);
  const as = async (name) => { await p.goto(APP); await byId(`pick-${name}`).click(); };

  // Fresh demo data
  const web = await b.newPage();
  await web.goto(SERVER); await web.click('button:has-text("Reset demo data")'); await web.waitForTimeout(1500);

  // Jordan: sees Maya's cycle and injections, not results
  await as('Jordan Torres');
  ok(await sees('Hi Jordan.'), 'Jordan signs in to his own home screen');
  ok(await sees('Supporting Maya'), 'It says who he is supporting');
  ok((await byId('shared-list').innerText()) === 'Her cycle · Injections', 'Shows exactly what Maya shares by default');
  ok(await text('Nurse reviewing').count() === 0, 'No results while Maya isn’t sharing them');
  await shot('1-jordan-home');

  // Helper walkthrough: steps but no logging
  await byId('help-tonight').click();
  ok(await sees('Helping Maya'), 'Walkthrough opens in helper mode');
  ok(await byId('log-dose').count() === 0, 'Jordan can’t log Maya’s doses');
  await shot('2-jordan-walk');
  for (let k = 0; k < 3; k++) { await byId('helper-next').click(); await p.waitForTimeout(400); }
  ok(await sees('logs each one on her phone'), 'Ends by saying Maya logs them');
  await p.getByText('Back', { exact: true }).click();

  // Notes
  await p.getByText('So proud of you', { exact: true }).click();
  await byId('note').press('Enter');
  ok(await sees('Sent. Maya will see it'), 'A note sends');
  await shot('3-jordan-note-sent');
  await byId('note').fill('She has chest pain and feels awful');
  await byId('note').press('Enter');
  ok(await sees('This needs a nurse now.'), 'An urgent symptom in a note tells Jordan to call');
  await shot('4-jordan-urgent');

  // Maya sees the notes and turns on results
  await as('Maya Torres');
  await byId('partner-note').first().waitFor({ timeout: 10000 });
  ok(await text('So proud of you').count() >= 1, 'Maya sees Jordan’s note on her home screen');
  ok(await sees('Jordan sounds worried about you.'), 'An urgent note shows Maya a call-the-nurse card, not "Thanks"');
  ok(await byId('partner-note-worried').locator('text=Thanks').count() === 0, 'No "Thanks" on the worried note');
  await shot('5-maya-note');
  await byId('note-ok').click(); await p.waitForTimeout(800);
  await byId('note-thanks').click(); await p.waitForTimeout(800);
  ok(await byId('partner-note').count() === 0 && await byId('partner-note-worried').count() === 0, '"I\'m okay" and "Thanks" clear the notes');
  await byId('avatar').click();
  ok(await sees('Sharing with Jordan'), 'Maya has sharing controls in settings');
  await byId('share-Jordan-results').click(); await p.waitForTimeout(1200);
  await shot('6-maya-sharing');

  // Jordan now sees results and that his note was seen
  await as('Jordan Torres');
  ok(await sees('Her cycle · Injections · Results'), 'Results appear once Maya shares them');
  ok(await text('Seen').count() >= 1, 'Jordan sees his note was seen');
  await shot('7-jordan-results');

  // The clinic never sees the notes
  await web.goto(SERVER); await web.click('button:has-text("Maria Lopez, RN")'); await web.waitForURL('**/nurse'); await web.waitForLoadState('networkidle');
  ok(!(await web.locator('body').innerText()).includes('chest pain'), 'Maria’s queue doesn’t contain partner notes');

  console.log('errors:', JSON.stringify(errs));
  console.log('shots:', D);
  await b.close();
})();

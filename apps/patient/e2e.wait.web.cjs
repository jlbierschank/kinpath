// Web check of the two-week wait and result day, across the clinic web app and the phone app.
// Start the server (pnpm dev:clinic) and the app on web (pnpm dev:patient, press w), then run with Playwright installed.
const { chromium } = require('playwright');
const APP = process.env.APP_URL ?? (process.env.APP ? process.env.APP + '/' : 'http://localhost:8081/');
const SERVER = (process.env.SERVER_URL ?? 'http://localhost:3000/').replace(/\/$/, '');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const web = await b.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); web.on('pageerror', e => errs.push(e.message));
  const D = require('os').tmpdir() + '/kinpath-wait-shots/'; require('fs').mkdirSync(D, { recursive: true });
  const shot = n => p.screenshot({ path: D + n + '.png', fullPage: true });
  const wshot = n => web.screenshot({ path: D + n + '.png', fullPage: true });
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  const byId = id => p.locator(`[data-testid="${id}"]`);
  const sees = s => p.getByText(s, { exact: false }).filter({ visible: true }).first().waitFor({ timeout: 10000 }).then(() => true, () => false);
  const wsees = s => web.getByText(s, { exact: false }).first().waitFor({ timeout: 10000 }).then(() => true, () => false);
  const as = async (name) => { await p.goto(APP); await byId(`pick-${name}`).click(); await p.waitForTimeout(800); };
  const webAs = async (name) => {
    await web.goto(SERVER + '/');
    const sw = web.locator('button:has-text("Switch person")'); if (await sw.count()) { await sw.click(); await web.waitForURL(SERVER + '/'); }
    await web.click(`button:has-text("${name}")`); await web.waitForURL(u => !u.toString().endsWith(':3000/'));
    await web.locator('text=Who are you testing as?').waitFor({ state: 'detached' }); await web.waitForLoadState('networkidle');
    await web.reload(); await web.waitForLoadState('networkidle'); // always a fresh copy of the page
  };
  const submit = async (loc) => { const prev = web.url(); await loc.click(); await web.waitForURL(u => u.toString() !== prev, { timeout: 10000 }); await web.waitForLoadState('networkidle'); };
  const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  // After 8 pm the demo seed moves "tonight" (and the cycle start) a day later; the transfer follows it.
  const T = new Date().getHours() >= 20 ? 4 : 5;
  const reset = async () => { await web.goto(SERVER + '/'); await web.click('button:has-text("Reset demo data")'); await web.waitForTimeout(1500); };
  const recordTransfer = async () => {
    await webAs('Maria Lopez, RN');
    await web.click('a:has-text("Maya Torres")'); await web.waitForURL('**/nurse/patients/*'); await web.waitForLoadState('networkidle');
    await web.fill('input[name=transferOn]', daysAgo(T));
    await web.fill('input[name=embryosFrozen]', '2');
    await submit(web.locator('button:has-text("Record transfer")'));
  };

  // ---- Part 1: the wait, and a negative result ----
  await reset();
  await recordTransfer();
  ok(await wsees('Transfer recorded'), 'Maria records the transfer from Maya’s page');
  await wshot('w1-nurse-transfer');

  await as('Maya Torres');
  ok(await sees(`Day ${T} of the wait`), `Maya’s home becomes "Day ${T} of the wait"`);
  ok(await byId('test-date').count() === 1, 'Her blood test date is shown');
  ok(await p.getByText('Walk me through tonight').count() === 0, 'Stimulation injections are gone');
  await byId('how-together').click();
  ok(await sees('Saved. Your care team will follow this.'), 'She chooses to hear it with Jordan');
  await byId('feel-struggling').click();
  ok(await sees('Your nurse will call you today'), '"Struggling" tells her a nurse will call');
  await p.getByText('Should I take a home test?', { exact: true }).click();
  ok(await sees('Your blood test is the one to trust'), 'Bayside’s approved answer appears');
  await shot('w2-maya-wait');
  await byId('rough-day').click();
  ok(await sees('What would help right now?'), '"Rough day?" opens support options');
  await shot('w3-rough-day');
  await byId('rough-calm').click();
  ok(await byId('breath-circle').count() === 1, 'Breathing circle');
  await shot('w4-breathe');
  await byId('breathe-done').click();
  ok(await sees('a few minutes just for you'), 'Comes back with a kind note');
  await byId('toggle-count').click(); await p.waitForTimeout(800);
  ok(await sees('The wait') && await p.getByText(`Day ${T} of the wait`).count() === 0, 'She can hide the day count');

  await as('Jordan Torres');
  const status = await byId('partner-status').innerText();
  ok(status.includes('two-week wait') && !status.includes('day 5'), 'Jordan sees the wait, without the day count Maya hid');
  ok(await sees('Her blood test'), 'Jordan sees the test date');
  ok(await sees('Whatever happens, we’re in this together') || await sees("Whatever happens, we're in this together"), 'His quick notes fit the wait');
  await shot('w5-jordan-wait');

  await webAs('Maria Lopez, RN');
  ok(await wsees('Calls to make') && await wsees('Said she is struggling'), 'Maria has a check-in call to make');
  await wshot('w6-nurse-calls');
  await web.fill('input[name=note]', 'Called. She is having a hard day; talked it through and offered the counselor.');
  await submit(web.locator('button:has-text("Done")'));
  ok(await web.getByText('Said she is struggling').count() === 0, 'Call marked done');

  await web.click('a:has-text("Maya Torres")'); await web.waitForURL('**/nurse/patients/*'); await web.waitForLoadState('networkidle');
  ok((await web.locator('[data-testid=result-how]').innerText()).includes('with her partner'), 'Maria sees Maya wants to hear it with Jordan');
  await web.fill('input[name=hcg]', '2');
  await web.check('input[name=outcome][value=negative]');
  await web.fill('textarea[name=note]', "I'm so sorry, Maya. I'll call you and Jordan at 2 today, and Dr. Patel will see you both next week to talk about what's next.");
  await submit(web.locator('button:has-text("Save result")'));
  ok(await wsees("can't see it until you release it"), 'Result saved but not released');

  await as('Maya Torres');
  ok(await p.getByText('sorry', { exact: false }).count() === 0, 'Maya sees nothing before release');

  await webAs('Maria Lopez, RN');
  await web.click('a:has-text("Maya Torres")'); await web.waitForURL('**/nurse/patients/*'); await web.waitForLoadState('networkidle');
  await submit(web.locator('button:has-text("Release to her app")'));
  ok(await wsees('Call them first, then release'), 'Release is refused until the call happens');
  await web.check('input[name=toldByPhone]');
  await submit(web.locator('button:has-text("Release to her app")'));
  ok(await wsees('Released'), 'Released after Maria confirms the call');
  await wshot('w7-nurse-released');

  await as('Maya Torres');
  ok(await sees('We’re so sorry, Maya.') || await sees("We're so sorry, Maya."), 'Maya sees the gentle negative-result screen');
  ok((await byId('result-note').innerText()).includes("I'll call you and Jordan"), 'With Maria’s note');
  ok(await byId('quiet-banner').count() === 1, 'The app is quiet for 14 days');
  await byId('ask-counselor').click();
  ok(await sees('will help you find a counselor'), 'She can ask about a counselor');
  await shot('w8-maya-negative');

  // When you're ready
  await byId('when-ready').click();
  ok(await sees('There’s no rush') || await sees("There's no rush"), '"When you’re ready" opens at her pace');
  ok((await byId('embryos').innerText()).includes('2 embryos in storage'), 'It shows her 2 embryos in storage');
  await byId('next-questions').fill('Should we test the embryos next time?');
  await byId('save-questions').click();
  ok(await sees('Saved.'), 'She saves her questions');
  await shot('w11-next-cycle');
  await byId('im-ready').click();
  ok(await sees('Your care team knows you’re ready') || await sees("Your care team knows you're ready"), 'She tells her team she’s ready');

  await as('Jordan Torres');
  const jt = await p.locator('body').innerText();
  ok(jt.includes("result is in") && !/negative|sorry|hCG/i.test(jt), 'Jordan learns only that the result is in, not what it is');
  await shot('w9-jordan-after');

  await webAs('Maria Lopez, RN');
  await web.goto(SERVER + '/nurse'); await web.waitForLoadState('networkidle');
  ok(await wsees('Follow-up after negative'), 'A follow-up call is on Maria’s list');
  ok(await wsees('Ready for next steps'), 'And a "ready for next steps" call');
  await web.click('a:has-text("Maya Torres")'); await web.waitForURL('**/nurse/patients/*'); await web.waitForLoadState('networkidle');
  ok((await web.locator('[data-testid=next-cycle]').innerText()).includes('Should we test the embryos'), 'Maria sees Maya’s questions');
  await wshot('w12-nurse-next-cycle');

  // ---- Part 2: a positive result, straight to the app ----
  await reset();
  await recordTransfer();
  await as('Maya Torres');
  await byId('how-app').click(); await p.waitForTimeout(800);
  await webAs('Maria Lopez, RN');
  await web.click('a:has-text("Maya Torres")'); await web.waitForURL('**/nurse/patients/*'); await web.waitForLoadState('networkidle');
  await web.fill('input[name=hcg]', '142');
  await web.check('input[name=outcome][value=positive]');
  await web.fill('textarea[name=note]', "Congratulations, Maya! Your hCG is 142. We'll repeat the blood test on Thursday to make sure it's rising, then plan your first ultrasound.");
  await submit(web.locator('button:has-text("Save result")'));
  await submit(web.locator('button:has-text("Release to her app")'));
  ok(await wsees('Released'), 'Released straight to the app, as Maya chose');
  await as('Maya Torres');
  ok(await sees('Your test is positive.'), 'Maya sees her positive result');
  ok(await sees('They can’t see your result') || await sees("They can't see your result"), 'Told that her support people can’t see it');
  await shot('w10-maya-positive');

  console.log('errors:', JSON.stringify(errs));
  console.log('shots:', D);
  await b.close();
})();

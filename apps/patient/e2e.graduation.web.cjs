// Web check of graduation: nurse graduates Maya, keepsake, OB-GYN summary link, sharing the news, thank-you.
// Start the server (pnpm dev:clinic) and the app on web (pnpm dev:patient, press w), then run with Playwright installed.
const { chromium } = require('playwright');
const APP = process.env.APP_URL ?? (process.env.APP ? process.env.APP + '/' : 'http://localhost:8081/');
const SERVER = (process.env.SERVER_URL ?? 'http://localhost:3000/').replace(/\/$/, '');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const p = await ctx.newPage();
  const web = await b.newPage({ viewport: { width: 1200, height: 900 } });
  const ob = await b.newPage({ viewport: { width: 1000, height: 1100 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); web.on('pageerror', e => errs.push(e.message));
  const D = require('os').tmpdir() + '/kinpath-grad-shots/'; require('fs').mkdirSync(D, { recursive: true });
  const shot = n => p.screenshot({ path: D + n + '.png', fullPage: true });
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  const byId = id => p.locator(`[data-testid="${id}"]`);
  const sees = s => p.getByText(s, { exact: false }).filter({ visible: true }).first().waitFor({ timeout: 10000 }).then(() => true, () => false);
  const wsees = s => web.getByText(s, { exact: false }).first().waitFor({ timeout: 10000 }).then(() => true, () => false);
  const as = async (name) => { await p.goto(APP); await byId(`pick-${name}`).click(); await p.waitForTimeout(900); };
  const webAs = async (name) => {
    await web.goto(SERVER + '/');
    const sw = web.locator('button:has-text("Switch person")'); if (await sw.count()) { await sw.click(); await web.waitForURL(SERVER + '/'); }
    await web.click(`button:has-text("${name}")`); await web.waitForURL(u => !u.toString().endsWith(':3000/'));
    await web.locator('text=Who are you testing as?').waitFor({ state: 'detached' });
    await web.reload(); await web.waitForLoadState('networkidle');
  };
  const submit = async (loc) => { const prev = web.url(); await loc.click(); await web.waitForURL(u => u.toString() !== prev, { timeout: 10000 }); await web.waitForLoadState('networkidle'); };
  const mayaPage = async () => { await webAs('Maria Lopez, RN'); await web.click('a:has-text("Maya Torres")'); await web.waitForURL('**/nurse/patients/*'); await web.waitForLoadState('networkidle'); };

  // Set up: transfer, positive result straight to the app
  await web.goto(SERVER + '/'); await web.click('button:has-text("Reset demo data")'); await web.waitForTimeout(1500);
  await mayaPage();
  const ago = new Date(); ago.setDate(ago.getDate() - 2);
  await web.fill('input[name=transferOn]', ago.toISOString().slice(0, 10));
  await submit(web.locator('button:has-text("Record transfer")'));
  await as('Maya Torres');
  await byId('how-app').click(); await p.waitForTimeout(800);
  await mayaPage();
  await web.fill('input[name=hcg]', '142');
  await web.check('input[name=outcome][value=positive]');
  await web.fill('textarea[name=note]', 'Congratulations, Maya! Your hCG is 142.');
  await submit(web.locator('button:has-text("Save result")'));
  await submit(web.locator('button:has-text("Release to her app")'));

  // Positive result: Jordan doesn't know yet
  await as('Jordan Torres');
  const before = await byId('partner-status').innerText();
  ok(before.includes('result is in') && !/positive|graduat/i.test(before), 'Before Maya shares, Jordan only knows the result is in');

  // Graduate
  await mayaPage();
  ok(await wsees('Graduate to her OB-GYN'), 'Maria can graduate Maya after a released positive');
  await web.fill('input[name=obName]', "Dr. Ana Reyes");
  await submit(web.locator('button:has-text("Graduate Maya")'));
  ok(await wsees('Graduated'), 'Maya is graduated');

  await as('Maya Torres');
  ok(await sees('You graduated, Maya.'), 'Maya sees her graduation');
  ok(await sees('From Bayside to Dr. Ana Reyes'), 'With her OB-GYN named');
  await shot('g1-maya-graduated');

  await as('Jordan Torres');
  const still = await byId('partner-status').innerText();
  ok(!/graduat|positive/i.test(still), 'Jordan still doesn’t know: graduation doesn’t give away the result');

  // Maya shares the news
  await as('Maya Torres');
  ok(await sees('Share the news with Jordan?'), 'Maya is asked whether to share the news');
  await byId('share-news').click();
  ok(await sees('Jordan can see your news now'), 'She shares it');
  await as('Jordan Torres');
  ok((await byId('partner-status').innerText()).includes('graduated to her OB-GYN'), 'Now Jordan sees she graduated');
  ok(await sees('So proud of you'), 'His quick notes fit the news');
  await shot('g2-jordan-news');

  // Keepsake
  await as('Maya Torres');
  await byId('open-keepsake').click();
  ok(await sees('injections, every one logged'), 'Keepsake lists her journey');
  await byId('keep-wait').click();
  await byId('save-keepsake').click();
  ok(await sees('Saved to your record.'), 'She leaves out the wait and saves');
  await shot('g3-keepsake');

  // OB-GYN summary
  await as('Maya Torres');
  await byId('open-share-summary').click();
  ok((await byId('summary-recipient').inputValue()) === 'Dr. Ana Reyes', 'Recipient is pre-filled with her OB-GYN');
  await byId('summary-meds').click();
  await byId('create-summary').click();
  await byId('summary-url').waitFor({ timeout: 10000 });
  const url = (await byId('summary-url').innerText()).trim();
  ok(/\/summary\/[A-Za-z0-9_-]{20,}$/.test(url), 'A secure link is created');
  await byId('copy-summary').click();
  ok((await p.evaluate(() => navigator.clipboard.readText())) === url, 'Copy link copies just the link');
  await shot('g4-share-link');

  await ob.goto(url); await ob.waitForLoadState('networkidle');
  ok((await ob.locator('[data-testid=summary-patient]').innerText()) === 'Maya Torres', 'The OB-GYN opens the summary');
  const sumText = await ob.locator('body').innerText();
  ok(sumText.includes('hCG 142') && sumText.includes('Embryo transfer'), 'It has her transfer and test');
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  ok(sumText.includes(today), 'The test shows the date the result came back');
  ok(!sumText.includes('Fertility medications'), 'Medications are left out, as Maya chose');
  await ob.screenshot({ path: D + 'g5-ob-summary.png', fullPage: true });

  await as('Maya Torres');
  await byId('open-share-summary').click();
  ok(await sees('Opened 1 time'), 'Maya sees it was opened');
  await byId('stop-share-0').click(); await p.waitForTimeout(1000);
  ok(await sees('Stopped or expired'), 'She stops sharing');
  await ob.goto(url); await ob.waitForLoadState('networkidle');
  ok(await ob.getByText("This link isn't available").count() === 1, 'The link stops working');

  // Thank-you
  await as('Maya Torres');
  await byId('thanks').fill('Maria, thank you for every late-night answer. You made this feel possible.');
  await byId('send-thanks').click();
  ok(await sees('on its way to your care team'), 'Thank-you sent');
  await webAs('Maria Lopez, RN');
  ok(await wsees('thank you for every late-night answer'), 'Maria sees the thank-you on her home');
  await web.screenshot({ path: D + 'g6-nurse-thanks.png', fullPage: true });

  console.log('errors:', JSON.stringify(errs));
  console.log('shots:', D);
  await b.close();
})();

// Browser check of the full loop. Start the app first (pnpm dev:clinic), then: node apps/clinic/e2e/loop.e2e.cjs (needs Playwright installed).
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const D = require('path').join(__dirname, '..', '.data', 'e2e-shots') + '/'; require('fs').mkdirSync(D, { recursive: true });
  const as = async (name) => { await p.goto('http://localhost:3000/'); const sw = p.locator('button:has-text("Switch person")'); if (await sw.count()) { await sw.click(); await p.waitForURL('http://localhost:3000/'); } await p.click(`button:has-text("${name}")`); await p.waitForURL(u => !u.toString().endsWith(':3000/')); await p.locator('text=Who are you testing as?').waitFor({ state: 'detached', timeout: 10000 }); await p.reload(); await p.waitForLoadState('networkidle'); };
  const shot = (n) => p.screenshot({ path: D + n + '.png', fullPage: true });
  const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) process.exitCode = 1; };

  await p.goto('http://localhost:3000/'); await p.click('button:has-text("Reset demo data")'); await p.waitForTimeout(1500);
  await as('Maya Torres'); await shot('1-maya-today');
  ok(await p.locator('text=Did you miss your Gonal-f?').count() === 1, 'Maya sees her missed Gonal-f');
  await p.click('button:has-text("I missed this dose")'); await p.locator('text=Sent to your nurse').waitFor({timeout:10000}).catch(()=>{});
  ok(await p.locator('text=Sent to your nurse').count() === 1, 'Missed dose shows as sent to nurse');

  await as('Maria Lopez, RN'); await shot('2-maria-queue');
  ok(await p.locator('text=Missed dose').count() >= 1, 'Maria sees the missed dose in her queue');
  await p.click('a:has-text("Open")'); await p.waitForURL('**/nurse/*'); await p.waitForLoadState('networkidle');
  ok(await p.locator('text=Reported missed').count() === 1, 'Dose log attached with the missed dose flagged');
  await p.click('button:has-text("Draft a reply")'); await p.locator('textarea[name=text]').waitFor({timeout:10000}); await shot('3-maria-draft');
  const draft = await p.inputValue('textarea[name=text]');
  ok(draft.startsWith('Hi Maya,'), 'Draft comes from the protocol: ' + draft.slice(0, 60));
  await p.click('button:has-text("Approve and send")'); await p.waitForURL('**/nurse');
  ok(await p.locator('text=Nothing needs you right now.').count() === 1, 'Queue is clear after sending');
  // enter an out-of-range result
  await p.fill('input[name=value]', '1.8'); await p.selectOption('select[name=analyte]', 'progesterone'); await p.selectOption('select[name=unit]', 'ng/mL');
  await p.click('button:has-text("Save result")'); await p.locator('text=Result to review').waitFor({timeout:10000}).catch(()=>{});
  ok(await p.locator('text=Result to review').count() === 1, 'Out-of-range result came back to the queue');
  await p.fill('input[name=value]', '612'); await p.click('button:has-text("Save result")'); await p.waitForURL('**/nurse');

  await as('Maya Torres');
  ok(await p.locator('text=Drafted with Kinpath, reviewed by Maria Lopez, RN.').count() === 1, 'Maya sees the reply with the disclosure line');
  ok(await p.locator('text=Nurse reviewing').count() === 1 && await p.locator("text=In Bayside's range").count() === 1, 'Maya sees one in-range and one nurse-review result');
  await shot('4-maya-reply');
  await p.click('button:has-text("Got it")'); await p.locator('button:has-text("Got it")').waitFor({state:'detached',timeout:10000});
  await p.fill('textarea[name=text]', "I'm really bloated and short of breath"); await p.click('button:has-text("Send")'); await p.waitForTimeout(1500);

  await as('Maria Lopez, RN');
  ok((await p.locator('.row').first().innerText()).includes('Urgent symptom'), 'Urgent message jumps to the top of the queue');
  await p.locator('.row').first().locator('a').click(); await p.waitForURL('**/nurse/*'); await p.waitForLoadState('networkidle'); await shot('5-maria-urgent');
  ok(await p.locator('button:has-text("Draft a reply")').count() === 0, 'No draft offered for an urgent message');
  await p.click('button:has-text("I called Maya")'); await p.waitForURL('**/nurse');

  await as('Jordan Torres'); await shot('6-jordan');
  ok(await p.locator("text=Maya isn't sharing results right now.").count() === 1, 'Jordan cannot see results');
  ok(await p.locator('text=Gonal-f').count() >= 1, 'Jordan can see shared medications');

  await as('Lee Grant, RN');
  ok(await p.locator('text=Maya Torres').count() === 0, 'Harbor nurse sees nothing of Bayside');

  await as('Kara Diaz'); await shot('7-audit');
  ok(await p.locator('text=staff sent reply').count() >= 1, 'Audit log records the sent reply');

  console.log('page errors:', JSON.stringify(errs));
  await b.close();
})();

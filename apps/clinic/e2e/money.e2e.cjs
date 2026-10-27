// Browser check of costs: counselor, patient, receipts, billing import, privacy. Start the app first.
const { chromium } = require('playwright');
const B = process.env.B || 'http://localhost:3000';
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const D = require('path').join(__dirname, '..', '.data', 'money-shots') + '/'; require('fs').mkdirSync(D, { recursive: true });
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  const shot = (n) => p.screenshot({ path: D + n + '.png', fullPage: true });
  const as = async (name) => { await p.goto(B + '/'); const sw = p.locator('button:has-text("Switch person")'); if (await sw.count()) { await sw.click(); await p.waitForURL(B + '/'); } await p.click(`button:has-text("${name}")`); await p.waitForURL(u => !u.toString().endsWith(':3000/')); await p.locator('text=Who are you testing as?').waitFor({ state: 'detached', timeout: 10000 }); await p.reload(); await p.waitForLoadState('networkidle'); };
  const after = async (re) => { await p.waitForURL(re); await p.reload(); await p.waitForLoadState('networkidle'); };

  await p.goto(B + '/'); await p.click('button:has-text("Reset demo data")'); await p.waitForTimeout(1500);

  // Maya looks at her costs and asks a question.
  await as('Maya Torres');
  await p.goto(B + '/patient'); await p.click('[data-testid=costs-link]'); await p.waitForLoadState('networkidle');
  ok(/You owe\s*\$1,790/.test(await p.textContent('[data-testid=cost-summary]')), 'Maya sees she owes $1,790 and when');
  ok(/\$4,620/.test(await p.textContent('[data-testid=patient-estimate]')), 'Her estimate shows her share after insurance ($4,620)');
  ok(/\$16,600 left of \$25,000/.test(await p.textContent('[data-testid=patient-coverage]')), 'Her coverage shows what\'s left of her fertility benefit');
  await p.fill('#question', 'Can I split the second payment into two?'); await p.click('button:has-text("Send")'); await after(/asked=1/);
  ok(await p.locator('text=Waiting for an answer.').count() === 1, 'Her question is sent to billing');
  await shot('m1-maya-costs');

  // A nurse can't open costs.
  await as('Maria Lopez, RN'); await p.goto(B + '/money'); await p.waitForLoadState('networkidle');
  ok(!p.url().includes('/money'), 'Nurses are sent away from the costs pages');

  // Sam answers, records a payment, and shares a new estimate.
  await as('Sam Kim');
  ok(p.url().endsWith('/money'), 'Sam lands on Costs');
  ok(await p.locator('[data-testid=money-row]:has-text("1 question")').count() === 1, 'He sees Maya has a question');
  await p.click('a:has-text("Maya Torres")'); await p.waitForLoadState('networkidle');
  await p.fill('textarea[name=answer]', 'Yes. I split it into two payments of $895, due on the 5th and the 20th.'); await p.click('button:has-text("Send")'); await after(/saved=Answered/);
  await p.selectOption('#kind', 'payment'); await p.fill('#description', 'Balance payment'); await p.fill('#amount', '1790'); await p.click('[data-testid=add-entry]'); await after(/saved=Payment/);
  ok((await p.textContent('[data-testid=balance]')).trim() === '$0', 'After the payment her balance is $0');
  await p.click('summary:has-text("Make a new estimate")');
  await p.fill('#title', 'Frozen embryo transfer'); await p.fill('input[name=label0]', 'Transfer'); await p.fill('input[name=amt0]', '3000'); await p.fill('input[name=ins0]', '2400');
  for (let i = 1; i < 12; i++) { await p.fill(`input[name=label${i}]`, ''); await p.fill(`input[name=amt${i}]`, ''); await p.fill(`input[name=ins${i}]`, ''); }
  await p.click('[data-testid=save-share]'); await after(/saved=Shared/);
  ok(/\$600/.test(await p.textContent('[data-testid=shared-estimate] [data-testid=you-pay]')), 'He shares a new estimate ($600 after insurance)');
  await shot('m2-sam-patient');

  // Maya sees all of it, and her receipt.
  await as('Maya Torres'); await p.goto(B + '/patient/costs'); await p.waitForLoadState('networkidle');
  ok(/all paid up/.test(await p.textContent('[data-testid=cost-summary]')), 'Maya sees she\'s paid up');
  ok(/Frozen embryo transfer/.test(await p.textContent('[data-testid=patient-estimate]')), 'And the new estimate');
  ok(await p.locator('text=Sam Kim: Yes. I split it').count() === 1, 'And Sam\'s answer');
  await p.locator('[data-testid=receipt-link]').first().click(); await p.waitForLoadState('networkidle');
  const receipt = await p.textContent('[data-testid=receipt]');
  ok(/Maya Torres/.test(receipt) && /\$1,790/.test(receipt) && /Bayside Fertility/.test(receipt) && /R-\d{8}-\d{3}/.test(receipt), 'Her receipt has her name, amount, clinic and receipt number');
  await shot('m3-receipt');

  // Jordan sees nothing unless she shares costs.
  const j = await (await fetch(B + '/api/partner/money', { headers: { Authorization: 'Dev 00000000-0000-4000-8000-000000000011' } })).json();
  ok(j.estimates.length === 0 && j.ledger.length === 0, 'Jordan sees no costs by default');

  // Billing data from elsewhere: an export uploaded by the admin.
  await as('Kara Diaz'); await p.goto(B + '/admin/records');
  const csv = require('path').join(D, 'billing.csv');
  require('fs').writeFileSync(csv, 'entry_id,mrn,last_name,type,description,amount,date,due_date\nb1,BF-100231,Torres,charge,Embryo storage (year 2),600,2026-10-26,2026-11-26\nb2,BF-000000,Nobody,charge,Unknown patient charge,100,2026-10-26,\n');
  await p.setInputFiles('input[type=file]', csv); await p.click('[data-testid=upload]'); await p.locator('[data-testid=upload-result]').waitFor();
  ok(/1 billing line, 1 to review/.test(await p.textContent('[data-testid=upload-result]')), 'A billing export is read: 1 line added, 1 to review');
  await as('Sam Kim'); await p.goto(B + '/money'); await p.waitForLoadState('networkidle');
  ok(await p.locator('[data-testid=billing-review]:has-text("Unknown patient charge")').count() === 1, 'Sam (not the nurses) reviews the unmatched bill');
  ok(await p.locator('[data-testid=money-row]:has-text("$600")').count() === 1, "Maya's new $600 charge shows in her balance");
  await shot('m4-sam-list');
  await as('Maria Lopez, RN'); await p.goto(B + '/nurse'); await p.waitForLoadState('networkidle');
  ok(await p.locator('text=Unknown patient charge').count() === 0, 'Maria never sees billing records');
  console.log('errors:', JSON.stringify(errs));
  await b.close();
})();

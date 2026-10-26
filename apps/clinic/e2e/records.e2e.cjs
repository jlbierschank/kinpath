// Browser + API check of the records connection. Start the app first, then: node apps/clinic/e2e/records.e2e.cjs
const { chromium } = require('playwright');
const B = process.env.B || 'http://localhost:3000';
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const D = require('path').join(__dirname, '..', '.data', 'records-shots') + '/'; require('fs').mkdirSync(D, { recursive: true });
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  const shot = (n) => p.screenshot({ path: D + n + '.png', fullPage: true });
  const as = async (name) => { await p.goto(B + '/'); const sw = p.locator('button:has-text("Switch person")'); if (await sw.count()) { await sw.click(); await p.waitForURL(B + '/'); } await p.click(`button:has-text("${name}")`); await p.waitForURL(u => !u.toString().endsWith(':3000/')); await p.locator('text=Who are you testing as?').waitFor({ state: 'detached', timeout: 10000 }); await p.reload(); await p.waitForLoadState('networkidle'); };

  await p.goto(B + '/'); await p.click('button:has-text("Reset demo data")'); await p.waitForTimeout(1500);
  await as('Kara Diaz');
  await p.goto(B + '/admin/records'); await p.waitForLoadState('networkidle');
  ok(await p.locator('h1:has-text("Records connection")').count() === 1, 'Admin sees the Records connection page');
  await p.fill('#name', 'Epic results feed'); await p.click('button:has-text("Create key")');
  await p.locator('[data-testid=new-key-value]').waitFor({ timeout: 10000 });
  const key = (await p.textContent('[data-testid=new-key-value]')).trim();
  ok(/^pk_/.test(key), 'A new key is shown once');
  ok(!p.url().includes(key), 'The key is not in the page address');
  await shot('r1-key');
  await p.reload(); await p.waitForLoadState('networkidle');
  ok(await p.locator('[data-testid=new-key-value]').count() === 0 && await p.locator('text=Epic results feed').count() >= 1, 'After reload the key is hidden and listed by name');

  // The records system sends a FHIR bundle.
  const today = new Date().toISOString();
  const bundle = { resourceType: 'Bundle', type: 'collection', entry: [
    { fullUrl: 'urn:uuid:p', resource: { resourceType: 'Patient', identifier: [{ value: 'BF-100231' }], name: [{ family: 'Torres' }] } },
    { resource: { resourceType: 'Observation', id: 'lab-77', status: 'final', code: { coding: [{ system: 'http://loinc.org', code: '2243-4' }] }, subject: { reference: 'urn:uuid:p' }, effectiveDateTime: today, valueQuantity: { value: 433, code: 'pg/mL' } } },
  ] };
  const post = (k, body, type = 'application/fhir+json') => fetch(B + '/api/integrations/records', { method: 'POST', headers: { Authorization: `Bearer ${k}`, 'Content-Type': type }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  let r = await post(key, bundle); let j = await r.json();
  ok(r.status === 200 && j.resultsAdded === 1, 'Records system sends a result: ' + JSON.stringify(j));
  ok(!JSON.stringify(j).includes('Torres') && !JSON.stringify(j).includes('433'), 'The reply has counts only, no patient details');
  r = await post(key, bundle); j = await r.json();
  ok(j.duplicates === 1 && j.resultsAdded === 0, 'Sending it again changes nothing');
  r = await post('pk_wrongwrongwrongwrongwrong', bundle);
  ok(r.status === 401, 'A wrong key is refused');
  r = await post(key, '{oops', 'application/json'); ok(r.status === 400, 'Bad JSON gets a clear 400');
  r = await post(key, `result_id,mrn,last_name,test,value,unit,collected_at\ncsv-1,BF-100231,Torres,progesterone,0.8,ng/mL,${today}`, 'text/csv'); j = await r.json();
  ok(j.resultsAdded === 1, 'A results CSV works too');

  await p.goto(B + '/admin/records'); await p.click('[data-testid=send-sample]'); await p.locator('[data-testid=records-saved]').waitFor();
  ok(/2 results added \(1 to the nurse first\), 1 order waiting for a nurse, 1 to review/.test(await p.textContent('[data-testid=records-saved]')), 'Demo sample records arrive');
  ok(await p.locator('[data-testid=import-row]').count() === 4, 'The log shows each delivery');
  await shot('r2-admin-log');
  await p.goto(B + '/admin'); await p.waitForLoadState('networkidle');
  ok(await p.locator('td:has-text("Epic results feed")').count() >= 1 && await p.locator('td:has-text("Records system")').count() >= 1, 'The audit log names the feed as the actor');

  await as('Maria Lopez, RN');
  await p.goto(B + '/nurse'); await p.waitForLoadState('networkidle');
  await shot('r3-nurse');
  ok(await p.locator('[data-testid=record-item]').count() === 2, 'Maria sees 2 records to review (new order, unknown MRN)');
  ok(await p.locator('text=progesterone 1.9 ng/mL').count() >= 1, 'The high progesterone is in her queue as a result to review');
  await p.click('button:has-text("Add to Maya\'s schedule")'); await p.waitForURL(/saved=/); await p.waitForLoadState('networkidle');
  ok(await p.locator('text=Added to Maya\'s schedule').count() === 1, 'Maria confirms the trigger-shot order');
  await p.selectOption('select[name=patientId]', { label: 'Maya Torres' }); await p.click('[data-testid=record-place]'); await p.waitForURL(/saved=Added%20to%20the%20patient/); await p.waitForLoadState('networkidle');
  ok(await p.locator('[data-testid=record-item]').count() === 0, 'She places the unmatched result on Maya; nothing left to review');
  await shot('r4-nurse-done');

  // Maya's schedule (via the API the phone uses) shows the new order.
  const sched = await (await fetch(B + '/api/patient/today', { headers: { Authorization: 'Dev 00000000-0000-4000-8000-000000000010' } })).json().catch(() => null);
  ok(sched && JSON.stringify(sched).includes('Ovidrel'), "Maya's schedule shows the Ovidrel trigger shot");
  console.log('errors:', JSON.stringify(errs));
  await b.close();
})();

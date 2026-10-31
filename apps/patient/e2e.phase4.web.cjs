// Phase 4, December items: insurance statements, where each item came from, data choices, and sending
// her record as a page + PDF + FHIR file by an expiring link. Run with APP=http://localhost:3000/phone.
const { chromium } = require('playwright');
const SERVER = 'http://localhost:3000', APP = process.env.APP ?? 'http://localhost:8081';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  const byId = (id) => p.locator(`[data-testid="${id}"]`).filter({ visible: true });
  const sees = (s, t = 10000) => p.getByText(s, { exact: false }).filter({ visible: true }).first().waitFor({ timeout: t }).then(() => true, () => false);
  const D = require('os').tmpdir() + '/kinpath-phone-shots/'; require('fs').mkdirSync(D, { recursive: true });
  const closeSheets = async () => { while (await byId('sheet-close').count()) { await byId('sheet-close').last().click(); await p.waitForTimeout(400); } };

  { const w = await b.newPage(); await w.goto(SERVER + '/'); await w.click('button:has-text("Reset demo data")'); await w.waitForTimeout(1500); await w.close(); }
  await p.goto(APP + '/'); await byId('pick-Alex Rivera').click(); await sees('Hi,', 15000);

  // An insurance statement, typed in (the AI reader does photos and PDFs the same way).
  await byId('solo-tab-add').click(); await byId('menu-type').click();
  await byId('type-text').fill("Explanation of benefits. This is not a bill.\nInsurer: Example Health Plan\nStatement date: 2026-10-20\nDeductible: $1,200 met of $2,000\nFertility benefit: $8,500 used of $25,000\nMonitoring ultrasound, amount billed $480, plan paid $300, you may owe $180");
  await byId('type-send').click();
  ok(await byId('item-coverage').first().waitFor({ timeout: 15000 }).then(() => true, () => false), 'A statement becomes an insurance coverage item to check');
  ok(/From: What you typed/.test(await byId('item-from').first().innerText()), 'Each item says where it came from');
  ok(await byId('f-payer').first().inputValue() === 'Example Health Plan' && await byId('f-fertilityMax').first().inputValue() === '25000', 'The insurer and amounts are filled in, and she can correct any field');
  await p.screenshot({ path: D + 'p4-1-coverage-check.png' });
  for (const kind of ['coverage', 'cost']) { const card = byId(`item-${kind}`).first(); await card.locator('[data-testid="item-save"]').click(); await p.waitForTimeout(1200); }
  await closeSheets();
  for (let i = 0; i < 4 && !(await byId('solo-tab-costs').count()); i++) { if (await byId('back').count()) await byId('back').first().click(); await p.waitForTimeout(600); }
  await byId('solo-tab-costs').click();
  ok(await byId('coverage-card').first().waitFor({ timeout: 10000 }).then(() => true, () => false) && await sees('$8,500 used of $25,000'), 'Costs shows her coverage: used and left, as printed');
  ok(await sees('$180'), 'Only what she may owe became a bill');
  await p.screenshot({ path: D + 'p4-2-costs.png' });

  // Her data choices: off until she turns them on.
  await byId('solo-tab-more').click();
  await byId('data-choices').scrollIntoViewIfNeeded();
  const on = async (id) => (await byId(id).getAttribute('aria-checked')) === 'true' || (await byId(id).locator('input').count() ? await byId(id).locator('input').isChecked() : false);
  ok(!(await on('choice-research')) && !(await on('choice-predictions')), 'Research and estimates are both off by default');
  await byId('choice-research').click(); await p.waitForTimeout(800);
  await p.reload(); await byId('pick-Alex Rivera').click().catch(() => {}); await sees('Hi,', 15000);
  await byId('solo-tab-more').click(); await byId('data-choices').scrollIntoViewIfNeeded();
  ok(await on('choice-research') && !(await on('choice-predictions')), 'Her choice is saved, and only that one changed');
  await p.screenshot({ path: D + 'p4-3-choices.png' });

  // Send her record.
  await byId('open-send').click();
  await byId('send-to').fill('Dr. Lee, new clinic');
  ok(!(await on('send-embryo')), 'Embryo details are off by default');
  ok(await sees("Don't send it to an employer or insurer"), 'A plain warning about receivers outside health privacy law');
  await byId('send-sec-coverage').click();
  await byId('send-make').click();
  const url = (await byId('send-url').innerText({ timeout: 10000 })).trim();
  ok(/\/summary\//.test(url), 'A secure link is made');
  await p.screenshot({ path: D + 'p4-4-send.png' });
  const r = await b.newPage();
  await r.goto(url);
  ok(await r.locator('[data-testid="summary-downloads"]').isVisible() && await r.locator('[data-testid="summary-coverage"]').isVisible(), 'The receiver opens it with no account, with downloads and the sections she chose');
  const pdf = await fetch(url + '/pdf'); const pdfBuf = Buffer.from(await pdf.arrayBuffer());
  ok(pdf.headers.get('content-type') === 'application/pdf' && pdfBuf.slice(0, 5).toString() === '%PDF-', 'The PDF downloads');
  const fhir = await (await fetch(url + '/fhir')).json();
  const types = fhir.entry.map((e) => e.resource.resourceType);
  ok(fhir.resourceType === 'Bundle' && types.includes('Consent') && types.includes('Provenance') && types.includes('Coverage') && types.includes('Observation'), 'The data file is a FHIR bundle with her consent, provenance, coverage and results');
  ok(!JSON.stringify(fhir).includes('conception-method'), 'No embryo details in it');
  await r.screenshot({ path: D + 'p4-5-received.png', fullPage: true });
  await byId('send-stop-0').click(); await p.waitForTimeout(800);
  ok((await fetch(url + '/fhir')).status === 404, 'Stopping it ends the link and its downloads');

  // A clinic's patient has the same choices.
  await p.goto(APP + '/'); await byId('pick-Maya Torres').click(); await sees('Hi, Maya', 15000);
  await byId('tab-you').click();
  ok(await byId('data-choices').first().waitFor({ timeout: 8000 }).then(() => true, () => false), "A clinic's patient has the same data choices");

  ok(errs.length === 0, 'No page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close();
})();

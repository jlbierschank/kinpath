// Denial letters and the year-end packet, on the Costs tab. Run with APP=http://localhost:3000/phone.
const { chromium } = require('playwright');
const SERVER = 'http://localhost:3000', APP = process.env.APP ?? 'http://localhost:8081';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  const byId = (id) => p.locator(`[data-testid="${id}"]`).filter({ visible: true });
  const sees = (s, t = 10000) => p.getByText(s, { exact: false }).filter({ visible: true }).first().waitFor({ timeout: t }).then(() => true, () => false);
  const D = require('os').tmpdir() + '/kinpath-phone-shots/'; require('fs').mkdirSync(D, { recursive: true });
  const closeSheets = async () => { while (await byId('sheet-close').count()) { await byId('sheet-close').last().click(); await p.waitForTimeout(400); } };
  const toCosts = async () => { await closeSheets(); for (let i = 0; i < 4 && !(await byId('solo-tab-costs').count()); i++) { if (await byId('back').count()) await byId('back').first().click(); await p.waitForTimeout(600); } await byId('solo-tab-costs').click(); };

  { const w = await b.newPage(); await w.goto(SERVER + '/'); await w.click('button:has-text("Reset demo data")'); await w.waitForTimeout(1500); await w.close(); }
  await p.goto(APP + '/'); await byId('pick-Alex Rivera').click(); await sees('Hi,', 15000);

  // A denial letter, typed in.
  await byId('solo-tab-add').click(); await byId('menu-type').click();
  await byId('type-text').fill("Notice of adverse determination\nInsurer: Example Health Plan\nClaim number: EX-20419\nDate of letter: 2026-10-21\nService: Frozen embryo transfer\nAmount denied: $3,200.00\nReason: Not medically necessary under your plan's fertility benefit.\nYour appeal must be received by 2027-04-20.");
  await byId('type-send').click();
  ok(await byId('item-denial').first().waitFor({ timeout: 15000 }).then(() => true, () => false), 'A denial letter becomes a denial to check, not a bill');
  ok(await byId('f-appeal').first().inputValue().then((v) => /2027|Apr/.test(v), () => false) || await sees('2027'), 'The appeal date is the one the letter printed');
  await p.screenshot({ path: D + 'den-1-check.png' });
  await byId('item-denial').first().locator('[data-testid="item-save"]').click(); await p.waitForTimeout(1200);
  await toCosts();
  ok(await byId('denials-card').first().waitFor({ timeout: 10000 }).then(() => true, () => false), 'Costs shows the denial');
  ok(await sees('Claim EX-20419') && await sees('Reason they gave: Not medically necessary'), 'With the claim number and the reason in the letter\'s words');
  ok(/days left/.test(await byId('denial-deadline-0').innerText()), 'With days left to the printed appeal date');
  ok(await sees("Pumpkin doesn't file appeals"), 'Honest about what Pumpkin does');
  await byId('denials-card').scrollIntoViewIfNeeded(); await p.screenshot({ path: D + 'den-2-costs.png' });
  await byId('denial-appealed-0').click();
  ok(await sees('Appealed'), 'She can mark it appealed');

  // A payment, then the year-end packet.
  await byId('solo-tab-add').click(); await byId('menu-type').click();
  await byId('add-hand-cost').click();
  await byId('f-payment').click(); await byId('f-desc').fill('Specialty pharmacy: Menopur'); await byId('f-amount').fill('640');
  await byId('byhand-save').click();
  await p.waitForTimeout(1000);
  await toCosts();
  await byId('tax-packet').scrollIntoViewIfNeeded();
  ok(await sees('Medications and pharmacy'), 'The packet groups payments by what they were for');
  ok(await sees('Your tax preparer or HSA/FSA administrator decides what qualifies'), 'It doesn\'t say what qualifies');
  await p.screenshot({ path: D + 'den-3-packet.png' });
  const [pdf] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), byId('tax-pdf').click()]);
  const pdfBuf = require('fs').readFileSync(await pdf.path()); require('fs').writeFileSync(D + 'den-packet.pdf', pdfBuf);
  ok(/\.pdf$/.test(pdf.suggestedFilename()) && pdfBuf.slice(0, 5).toString() === '%PDF-', 'The PDF downloads');
  const [csv] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), byId('tax-csv').click()]);
  const csvText = require('fs').readFileSync(await csv.path(), 'utf8');
  ok(/Menopur/.test(csvText) && /"640.00"/.test(csvText), 'The spreadsheet file downloads with each payment');

  ok(errs.length === 0, 'No page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
})();

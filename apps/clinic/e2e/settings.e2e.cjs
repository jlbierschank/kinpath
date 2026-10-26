const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const D = require('path').join(__dirname, '..', '.data', 'settings-shots') + '/'; require('fs').mkdirSync(D, { recursive: true });
  const shot = n => p.screenshot({ path: D + n + '.png', fullPage: true });
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  const as = async (name) => { await p.goto('http://localhost:3000/'); const sw = p.locator('button:has-text("Switch person")'); if (await sw.count()) { await sw.click(); await p.waitForURL('http://localhost:3000/'); } await p.click(`button:has-text("${name}")`); await p.waitForURL(u => !u.toString().endsWith(':3000/')); await p.locator('text=Who are you testing as?').waitFor({ state: 'detached', timeout: 10000 }); await p.waitForLoadState('networkidle'); };
  const settled = () => p.waitForLoadState('networkidle');
  const sees = (t) => p.locator('text=' + t).first().waitFor({ timeout: 10000 }).then(() => true, () => false);
  const submit = async (loc) => { const prev = p.url(); await loc.click(); await p.waitForURL(u => u.toString() !== prev, { timeout: 10000 }); await settled(); };

  await p.goto('http://localhost:3000/'); await p.click('button:has-text("Reset demo data")'); await p.waitForTimeout(1500);

  // Maria enters an estradiol result above range
  await as('Maria Lopez, RN');
  await p.fill('input[name=value]', '950'); await p.click('button:has-text("Save result")'); await p.locator('text=Result to review').waitFor({ timeout: 10000 });
  await p.click('text=Clinic settings →'); await p.waitForURL('**/settings'); await settled();
  await shot('1-ranges');
  ok(await p.locator('text=300–900 pg/mL').count() === 1, 'Ranges tab lists estradiol 300–900');

  // Bad edit is refused
  const est = p.locator('details', { hasText: '300–900 pg/mL' });
  await est.locator('summary').click();
  await est.locator('input[name=low]').fill('2000');
  await submit(est.locator('button:has-text("Save and approve")'));
  ok(await sees('Low must be at or below high.'), 'A bad range is refused with a plain message');

  // Good edit
  const est2 = p.locator('details', { hasText: '300–900 pg/mL' });
  await est2.locator('summary').click();
  await est2.locator('input[name=high]').fill('1000');
  await submit(est2.locator('button:has-text("Save and approve")'));
  ok(await sees('300–1000 pg/mL'), 'Range updated to 300–1000');

  // Urgent word
  await p.click('a:has-text("Urgent words")'); await p.waitForURL('**tab=urgent'); await settled();
  await p.fill('input[name=term]', 'dizzy'); await submit(p.locator('button:has-text("Add word")'));
  ok(await sees('added by Maria Lopez, RN'), 'Urgent word added with Maria’s name');
  await shot('2-urgent');

  // Reorder walkthrough
  await p.click('a:has-text("Injection walkthroughs")'); await p.waitForURL('**tab=walkthroughs'); await settled();
  await submit(p.locator('button[aria-label="Move Cetrotide earlier"]'));
  await p.locator('summary b:has-text("Cetrotide")').waitFor();
  { const prev = await p.locator('details summary b').first().innerText(); await p.locator('button[aria-label="Move Cetrotide earlier"]').click(); await p.waitForFunction((t) => document.querySelector('details summary b')?.textContent !== t, prev, { timeout: 10000 }); }
  ok((await p.locator('details summary b').first().innerText()).includes('1. Cetrotide'), 'Cetrotide moved to first');
  await shot('3-walkthroughs');

  await p.click('a:has-text("Change history")'); await p.waitForURL('**tab=history'); await settled();
  ok(await p.locator('td:has-text("urgent word: dizzy")').count() === 1 && await p.locator('td:has-text("range: estradiol")').count() >= 1, 'Change history records each edit');
  await shot('4-history');

  // Maya sees the effects
  await as('Maya Torres');
  ok(await p.locator("text=In Bayside's range").count() === 1, 'Maya’s 950 result is now in range with Maria’s text');
  await p.fill('textarea[name=text]', 'I feel dizzy this morning'); await p.click('button:has-text("Send")'); await p.waitForTimeout(1500);
  await as('Maria Lopez, RN');
  ok((await p.locator('.row').first().innerText()).includes('Urgent symptom'), 'Maya’s "dizzy" message jumped to the top as urgent');

  // Kara can view, not edit
  await as('Kara Diaz');
  await p.click('text=Clinic settings (view only)'); await p.waitForURL('**/settings'); await settled();
  ok(await p.locator('text=only nurses and physicians can change them').count() === 1 && await p.locator('button:has-text("Save and approve")').count() === 0, 'Admin sees settings read-only');
  await shot('5-admin-readonly');
  console.log('errors:', JSON.stringify(errs));
  await b.close();
})();

// Connecting her own Pumpkin to her clinic: she asks and picks what to share, a nurse confirms it's her,
// the nurse sees only what she shares, and stopping ends it. Run with APP=http://localhost:3000/phone.
const { chromium } = require('playwright');
const SERVER = 'http://localhost:3000', APP = process.env.APP ?? 'http://localhost:8081';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  const byId = (pg, id) => pg.locator(`[data-testid="${id}"]`).filter({ visible: true });
  const sees = (pg, s, t = 10000) => pg.getByText(s, { exact: false }).filter({ visible: true }).first().waitFor({ timeout: t }).then(() => true, () => false);

  { const w = await b.newPage(); await w.goto(SERVER + '/'); await w.click('button:has-text("Reset demo data")'); await w.waitForTimeout(1500); await w.close(); }

  // Alex, on her own, finds Bayside and asks to connect.
  await p.goto(APP + '/'); await p.locator('[data-testid="pick-Alex Rivera"]').click(); await sees(p, 'Hi,', 15000);
  await byId(p, 'solo-tab-more').click();
  await byId(p, 'clinic-connect').scrollIntoViewIfNeeded();
  await byId(p, 'connect-search').fill('Bays');
  await byId(p, 'connect-pick-bayside').click();
  ok(await sees(p, 'sees the name and contact you signed up with'), 'Before asking, she sees exactly what the clinic will see');
  await byId(p, 'connect-share-results').click(); // keep results private
  await byId(p, 'connect-ask').click();
  ok(await sees(p, 'Waiting for Bayside Fertility to confirm'), 'Request sent; nothing shared until the clinic confirms');

  // Maria at Bayside confirms it's her and matches her chart.
  const c = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await c.goto(SERVER + '/'); await c.locator('form button', { hasText: 'Maria Lopez' }).click(); await c.waitForURL(/\/nurse/);
  const req = c.locator('[data-testid="connect-requests"]');
  ok(await req.isVisible() && /Alex/.test(await req.innerText()) && /Medications/.test(await req.innerText()) && !/Results/.test(await req.innerText()), 'The nurse sees the request with what she shares (and not results)');
  await req.locator('select').first().selectOption({ label: 'Priya Shah' });
  await req.locator('[data-testid="connect-accept"]').first().click();
  await c.waitForURL(/saved=/);
  ok(await c.locator('[data-testid="connect-requests"]').count() === 0, 'Confirmed; the request leaves the list');
  await c.goto(SERVER + '/nurse/patients/00000000-0000-4000-8000-000000000101');
  const panel = c.locator('[data-testid="linked-space"]');
  ok(await panel.isVisible(), "Her patient page shows 'From her Pumpkin'");
  const txt = await panel.innerText();
  ok(/Follistim/.test(txt) && /Entered by her/.test(txt), 'It shows her medications, labeled as entered by her');
  ok(!/Results she added/.test(txt), 'It leaves out what she kept private');

  // She sees it's connected, changes what's shared, then stops.
  await p.reload(); await p.locator('[data-testid="pick-Alex Rivera"]').click(); await sees(p, 'Hi,', 15000);
  await byId(p, 'solo-tab-more').click();
  ok(await sees(p, 'Connected to Bayside Fertility'), 'She sees she is connected');
  await byId(p, 'connect-share-meds').click(); await sees(p, 'Saved. Your clinic sees the change');
  await c.reload();
  ok(!/Her medications/.test(await c.locator('[data-testid="linked-space"]').innerText()), 'Unsharing medications removes them from the clinic view right away');
  await byId(p, 'connect-stop').click(); await byId(p, 'connect-stop-yes').click();
  await sees(p, "Your clinic can't see your Pumpkin anymore");
  await c.reload();
  ok(await c.locator('[data-testid="linked-space"]').count() === 0, 'Stopping ends the clinic view at once');

  ok(errs.length === 0, 'No page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close();
})();

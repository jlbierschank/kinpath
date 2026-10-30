// Refill requests reach the nurse, from the clinic's app and from her own connected Pumpkin, and the
// nurse marks what happened. Plus the clinic's pilot numbers. Run with APP=http://localhost:3000/phone.
const { chromium } = require('playwright');
const SERVER = 'http://localhost:3000', APP = process.env.APP ?? 'http://localhost:8081';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  const byId = (pg, id) => pg.locator(`[data-testid="${id}"]`).filter({ visible: true });
  const sees = (pg, s, t = 10000) => pg.getByText(s, { exact: false }).filter({ visible: true }).first().waitFor({ timeout: t }).then(() => true, () => false);
  const D = require('os').tmpdir() + '/kinpath-phone-shots/'; require('fs').mkdirSync(D, { recursive: true });

  { const w = await b.newPage(); await w.goto(SERVER + '/'); await w.click('button:has-text("Reset demo data")'); await w.waitForTimeout(1500); await w.close(); }
  const c = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const asMaria = async () => { await c.goto(SERVER + '/'); await c.locator('form button', { hasText: 'Maria Lopez' }).click(); await c.waitForURL(/\/nurse/); };

  // 1. Maya, a Bayside patient, asks for a refill in the clinic's app.
  await p.goto(APP + '/'); await byId(p, 'pick-Maya Torres').click(); await sees(p, 'Maya', 15000);
  await byId(p, 'tab-record').click(); await sees(p, 'Your record');
  await byId(p, 'refill-ask').scrollIntoViewIfNeeded(); await byId(p, 'refill-ask').click();
  ok(await byId(p, 'refill-ask-send').isDisabled(), 'Send waits until she picks a medication');
  await byId(p, 'refill-ask-med-0').click();
  const med = (await byId(p, 'refill-ask-med-0').innerText()).trim();
  await byId(p, 'refill-ask-note').fill('Two doses left.');
  await byId(p, 'refill-ask-send').click();
  ok(await sees(p, 'Sent to Bayside. A nurse will mark it'), 'She sees it went to a nurse');
  await p.screenshot({ path: D + 'refill-1-sent.png' });

  // Maria sees it in her queue and marks it sent to the pharmacy.
  await asMaria();
  const row = c.locator('.row', { hasText: `Refill request: ${med}` }).first();
  ok(await row.isVisible() && /Refill request/.test(await row.innerText()), 'It lands in the nurse queue with a Refill request label');
  await row.locator('a', { hasText: 'Open' }).click();
  await c.locator('[data-testid="refill-handle"]').waitFor();
  await c.fill('#rnote', 'Ready after 3 pm.');
  await c.locator('[data-testid="refill-done"]').click();
  await c.waitForURL(/saved=/);
  ok(await c.locator('.row', { hasText: `Refill request: ${med}` }).count() === 0, 'Handled; it leaves the queue');

  // An urgent note doesn't sit as a quiet refill.
  await byId(p, 'refill-ask-sent').locator('text=Ask for another').click();
  await byId(p, 'refill-ask-med-0').click();
  await byId(p, 'refill-ask-note').fill("I have severe abdominal pain and can't breathe well");
  await byId(p, 'refill-ask-send').click();
  ok(await sees(p, 'sounds urgent'), 'A note that sounds urgent is sent as urgent, and she is told to call');

  // 2. Alex, on her own, connects to Bayside sharing her medications.
  await p.goto(APP + '/'); await byId(p, 'pick-Alex Rivera').click(); await sees(p, 'Hi,', 15000);
  await byId(p, 'solo-tab-record').click();
  ok(await byId(p, 'refill-ask').count() === 0, 'Not connected: no refill ask in her own Pumpkin');
  await byId(p, 'solo-tab-more').click();
  await byId(p, 'clinic-connect').scrollIntoViewIfNeeded();
  await byId(p, 'connect-search').fill('Bays'); await byId(p, 'connect-pick-bayside').click(); await byId(p, 'connect-ask').click();
  await sees(p, 'Waiting for Bayside Fertility');
  await asMaria();
  const req = c.locator('[data-testid="connect-requests"]');
  await req.locator('select').first().selectOption({ label: 'Priya Shah' });
  await req.locator('[data-testid="connect-accept"]').first().click(); await c.waitForURL(/saved=/);

  await byId(p, 'solo-tab-record').click();
  await byId(p, 'refill-ask').waitFor({ timeout: 10000 }).catch(() => {});
  ok(await byId(p, 'refill-ask').count() === 1, 'Connected and sharing medications: she can ask Bayside for a refill');
  await byId(p, 'refill-ask').click();
  await byId(p, 'refill-ask-med-0').click();
  await byId(p, 'refill-ask-send').click();
  ok(await sees(p, 'Sent to Bayside Fertility'), 'Sent from her own Pumpkin');
  ok(await sees(p, 'Waiting for Bayside Fertility.'), 'She sees it waiting');

  await asMaria();
  const r2 = c.locator('.row', { hasText: 'from her own Pumpkin' }).first();
  ok(await r2.isVisible(), 'The queue marks it as from her own Pumpkin');
  await r2.locator('a', { hasText: 'Open' }).click();
  await c.locator('[data-testid="from-her-space"]').waitFor({ timeout: 8000 }).catch(() => {});
  ok(await c.locator('[data-testid="from-her-space"]').isVisible() && await c.locator('text=Draft a reply').count() === 0, 'The nurse is told she can\'t read a written reply, and no reply drafting is offered');
  await c.check('input[value="call"]');
  await c.locator('[data-testid="refill-done"]').click(); await c.waitForURL(/saved=/);

  await byId(p, 'solo-tab-today').click(); await byId(p, 'solo-tab-record').click();
  ok(await sees(p, 'will call you about this refill'), 'Back in her Pumpkin, she sees who handled it and what happens next');
  await p.screenshot({ path: D + 'refill-2-own.png' });

  // 3. Pilot numbers, for the clinic.
  await c.goto(SERVER + '/nurse'); await c.locator('a', { hasText: 'Pilot numbers' }).click();
  await c.locator('[data-testid="pilot"]').waitFor();
  const pilot = await c.locator('[data-testid="pilot"]').innerText();
  ok(/Calls logged per active cycle/.test(pilot) && /Consults that became cycles/.test(pilot), 'Pilot page shows calls per cycle and consults to cycles');
  ok((await c.locator('[data-testid="pilot-Refill requests"]').innerText()).trim() === '2', 'It counts both refill requests (the urgent note counts as urgent, not a refill)');
  ok(!/Maya|Priya|Alex/.test(await c.locator('main, body').first().innerText()), 'Counts only, no names');
  await c.screenshot({ path: D + 'refill-3-pilot.png', fullPage: true });
  await c.goto(SERVER + '/'); await c.locator('form button', { hasText: 'Kara' }).click();
  await c.goto(SERVER + '/pilot?days=90');
  ok(await c.locator('[data-testid="pilot"]').isVisible(), 'A clinic admin sees the pilot numbers too');

  ok(errs.length === 0, 'No page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close();
})();

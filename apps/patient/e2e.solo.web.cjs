// Phone app, on your own: sign up, Today, Add anything, checking items, record, costs, calendar, urgent.
// Start the server (KINPATH_DEV_LOGIN=1) and the app on web (EXPO_PUBLIC_DEMO=1), then run with Playwright.
const { chromium } = require('playwright');
const SERVER = 'http://localhost:3000', APP = process.env.APP ?? 'http://localhost:8081';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  const D = require('os').tmpdir() + '/kinpath-phone-shots/'; require('fs').mkdirSync(D, { recursive: true });
  const shot = n => p.screenshot({ path: D + n + '.png' });
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  const byId = id => p.locator(`[data-testid="${id}"]`);
  const text = s => p.getByText(s, { exact: false });
  const sees = async (s, t = 10000) => { try { await text(s).first().waitFor({ timeout: t }); return true; } catch { return false; } };
  const codeFor = async (to) => { const o = await b.newPage(); await o.goto(SERVER + '/dev/outbox'); const rows = await o.locator('[data-testid=outbox-row]').allInnerTexts(); await o.close(); return rows.find((x) => x.includes(to) && /\b\d{6}\b/.test(x)).match(/\b(\d{6})\b/)[1]; };

  { const w = await b.newPage(); await w.goto(SERVER + '/'); await w.click('button:has-text("Reset demo data")'); await w.waitForTimeout(1500); await w.close(); }

  // ---------- Alex, on her own ----------
  await p.goto(APP + '/');
  await byId('pick-Alex Rivera').click();
  ok(await sees('2 things Pumpkin read for you', 15000), 'Today: 2 things waiting to check');
  ok(await sees('Follistim 200 IU'), 'Today: tonight\'s med she added');
  ok(await sees('$6,133'), 'Today: next payment');
  ok(await sees('YOUR LATEST NUMBERS'), 'Today: latest numbers');
  ok(await sees('Want your clinic on Pumpkin?'), 'Today: ask my clinic');
  await shot('solo-1-today');

  // Check what Pumpkin read: the med needs a tick.
  await byId('to-check').click();
  await byId('item-medication').waitFor();
  ok(await sees('Check this'), 'Unsure fields are flagged "Check this"');
  ok(await byId('item-medication').locator('[data-testid=item-save]').isDisabled(), 'Med can\'t be added until she ticks that she checked it');
  await shot('solo-2-check');
  await byId('med-checked').click();
  await byId('item-medication').locator('[data-testid=item-save]').click();
  await byId('item-appointment').locator('[data-testid=item-save]').click();
  ok(await sees('Added 2 things to your record.'), 'Both added; back on Today');
  await shot('solo-3-added');

  // Add a sample lab report.
  await byId('solo-tab-add').click();
  await byId('sample-lab-report').click();
  await byId('item-result').first().waitFor({ timeout: 15000 });
  ok(await byId('item-result').count() === 3, 'Sample lab report read into 3 results');
  await shot('solo-4-results-to-check');
  for (let i = 0; i < 3; i++) { await byId('item-result').first().locator('[data-testid=item-save]').click(); await p.waitForTimeout(500); }
  ok(await sees('Added 3 things'), 'Results added');
  await byId('solo-tab-record').click();
  await byId('result-estradiol').waitFor();
  ok(await byId('result-estradiol').getByText("Lab's reference range: Follicular phase 27-433 pg/mL").count() === 1, "Record shows the lab's own range");
  await byId('result-estradiol').getByText('What this test measures').click();
  ok(await sees('Growing follicles make it'), 'Explains what estradiol measures');
  ok(await text(/\b(normal|abnormal|too high|too low)\b/i).count() === 0, 'No verdicts anywhere on the record');
  await shot('solo-5-record');

  // Type something urgent.
  await byId('solo-tab-add').click();
  await byId('add-type').click();
  await byId('type-text').fill("I'm bleeding heavily and the pain is severe");
  await byId('type-send').click();
  await byId('solo-urgent').waitFor();
  ok(await sees('Call (813) 555-0199'), 'Urgent goes to her clinic\'s after-hours line');
  ok(await sees('call 911'), 'And 911');
  await shot('solo-6-urgent');
  await p.getByText('Back to today').click();

  // Type a normal note.
  await byId('solo-tab-add').click();
  await byId('add-type').click();
  await byId('type-text').fill('Can I keep running during stims?\n$250 due Nov 30 for embryo storage');
  await byId('type-send').click();
  await byId('item-question').waitFor();
  ok(await byId('item-cost').count() === 1, 'Typed note becomes a question and a cost');
  await byId('item-cost').locator('[data-testid=item-save]').click(); await p.waitForTimeout(400);
  await byId('item-question').locator('[data-testid=item-dismiss]').click();
  await sees('Added to your record.');

  // Costs.
  await byId('solo-tab-costs').click();
  ok(await sees('$6,133 due'), 'Costs: next payment due');
  ok(await sees('Embryo storage', 5000) || await sees('embryo storage'), 'Costs: the bill she added');
  await shot('solo-7-costs');

  // Settings: calendar link.
  await byId('solo-tab-more').click();
  await byId('calendar-link').click();
  await byId('calendar-url').waitFor();
  const url = (await byId('calendar-url').innerText()).trim();
  const ics = await (await fetch(url)).text();
  ok(/SUMMARY:Appointment/.test(ics) && !/ultrasound/i.test(ics), 'Calendar feed hides what visits are for by default');
  await shot('solo-8-settings');
  await byId('solo-signout').click();

  // ---------- A new person signs up (demo builds skip the waitlist) ----------
  await byId('start-on-my-own').click();
  await byId('signup-contact').fill('rae.new@example.com');
  await byId('signup-start').click();
  await byId('signup-code').waitFor();
  await byId('signup-code').fill(await codeFor('rae.new@example.com'));
  await byId('signup-verify').click();
  await byId('signup-first').fill('Rae');
  await byId('stage-just_starting').click();
  await byId('signup-clinic').fill('Gulf Coast Fertility');
  await shot('solo-9-signup');
  await byId('signup-finish').click();
  ok(await sees('Today', 15000) && await sees('Just starting'), 'Signed up and landed on Today');
  ok(await sees('Want your clinic on Pumpkin?'), 'New space offers to ask her clinic');
  await byId('ask-clinic').click();
  ok(await sees("We'll reach out to them"), 'Asked her clinic to join');
  ok((await byId('ask-clinic-text').innerText()).includes('Gulf Coast Fertility'), 'Gets a note she can send her clinic');
  await p.getByText('Done', { exact: true }).click();
  ok(await sees('You asked Gulf Coast Fertility to join'), 'Today remembers she asked');
  await shot('solo-10-new');

  // Delete her account.
  await byId('solo-tab-more').click();
  await byId('delete-confirm').fill('delete');
  await byId('delete-account').click();
  ok(await sees('Welcome.', 15000), 'Account deleted and signed out');

  ok(errs.length === 0, 'No page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close();
})();

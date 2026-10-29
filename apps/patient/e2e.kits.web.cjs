// Phone app, on your own, Phase 2: the first-consult kit, the test calendar, and getting ready for an OB.
// Start the server (KINPATH_DEV_LOGIN=1) and run with APP=http://localhost:3000/phone.
const { chromium } = require('playwright');
const SERVER = 'http://localhost:3000', APP = process.env.APP ?? 'http://localhost:8081';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  const D = require('os').tmpdir() + '/kinpath-phone-shots/'; require('fs').mkdirSync(D, { recursive: true });
  const shot = n => p.screenshot({ path: D + n + '.png', fullPage: true });
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  const byId = id => p.locator(`[data-testid="${id}"]`);
  const text = s => p.getByText(s, { exact: false });
  const sees = async (s, t = 10000) => { try { await text(s).filter({ visible: true }).first().waitFor({ timeout: t }); return true; } catch { return false; } };
  const codeFor = async (to) => { const o = await b.newPage(); await o.goto(SERVER + '/dev/outbox'); const rows = await o.locator('[data-testid=outbox-row]').allInnerTexts(); await o.close(); return rows.find((x) => x.includes(to) && /\b\d{6}\b/.test(x)).match(/\b(\d{6})\b/)[1]; };
  const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  { const w = await b.newPage(); await w.goto(SERVER + '/'); await w.click('button:has-text("Reset demo data")'); await w.waitForTimeout(1500); await w.close(); }

  // ---------- Getting started with a clinic ----------
  await p.goto(APP + '/');
  await byId('start-on-my-own').click();
  await byId('stage-just_starting').click(); await byId('fr-next').click();
  await byId('fr-skip').click(); await byId('fr-skip').click();
  await byId('fr-save').click();
  await byId('signup-contact').fill('kim.kit@example.com'); await byId('signup-start').click();
  await byId('signup-code').fill(await codeFor('kim.kit@example.com')); await byId('signup-verify').click();
  await byId('signup-first').fill('Kim'); await byId('signup-finish').click();
  ok(await sees('Hi, Kim.', 15000), 'Signed up, on Today');
  ok(await byId('consult-tile').count() === 1 && await byId('tests-tile').count() === 1, 'Today leads with the first-consult kit and the test calendar');
  await shot('kits-1-today');

  await byId('consult-tile').click();
  await byId('kit-consult-on').fill(day(7));
  await byId('kit-consult-time').fill('10:30');
  await byId('kit-consult-add').click();
  ok(await sees('Added to your visits'), 'Consult date added to her visits');
  await byId('kit-bring-insurance').click(); await byId('kit-bring-cycle').click();
  ok(await sees('2 of 7 ready'), 'What to bring: ticks are counted');
  await byId('kit-question').fill('How many cycles do people usually try?'); await byId('kit-question-add').click();
  ok(await sees('How many cycles do people usually try?'), 'Adds a question for the visit');
  await byId('kit-notes').fill('AMH any day. HSG after my period.\n$250 due Dec 1 for the consult');
  await byId('kit-notes-save').click();
  await byId('kit-notes-sort').waitFor();
  ok(await byId('solo-urgent').count() === 0, 'Calm notes save quietly');
  await byId('kit-next-tests').click();
  await shot('kits-2-consult');
  await byId('kit-notes-sort').click();
  await byId('item-cost').waitFor({ timeout: 15000 });
  ok(await byId('item-cost').count() === 1, 'Notes become things to check (a cost)');
  await byId('item-cost').locator('[data-testid=item-save]').click();
  await p.waitForTimeout(600);

  // The test calendar.
  await byId('solo-tab-today').click();
  ok(await sees('2 of 7 things to bring are ready'), 'Today shows the consult date and what is ready');
  await byId('tests-tile').click();
  ok((await byId('kit-when-fsh').innerText()) === 'Cycle day 2 to 4', 'Without a day 1, tests show their cycle days');
  await byId('kit-day1').fill(day(-1));
  await p.waitForTimeout(400);
  ok(/ to /.test(await byId('kit-when-fsh').innerText()) && !/Cycle day/.test(await byId('kit-when-fsh').innerText()), 'With day 1, day 2 to 4 tests get dates');
  ok((await byId('kit-when-amh').innerText()) === 'Any day', 'Any-day tests say so');
  await byId('kit-done-amh').click();
  ok(await byId('kit-done-amh').getByText('Done').count() === 1, 'Marks a test done');
  // Add a result right from the test: the form opens with the test filled in, then comes back here.
  await byId('kit-add-progesterone').click();
  await byId('f-test').filter({ visible: true }).waitFor();
  ok(await byId('f-test').filter({ visible: true }).inputValue() === 'Progesterone', 'Add result opens with the test name filled in');
  await byId('f-value').filter({ visible: true }).fill('14.2'); await byId('f-unit').filter({ visible: true }).fill('ng/mL');
  await byId('byhand-save').filter({ visible: true }).click();
  await byId('kit-result-progesterone').filter({ visible: true }).waitFor({ timeout: 10000 });
  ok(/14\.2 ng\/mL/.test(await byId('kit-result-progesterone').filter({ visible: true }).innerText()), 'Back on the test calendar, the result shows on its test');
  ok(await byId('kit-done-progesterone').filter({ visible: true }).getByText('Done').count() === 1, 'A test with a result counts as done');
  ok(await byId('kit-report-hsg').count() === 1, 'Tests without a number offer to add the report');
  await byId('kit-hide-semen').click();
  ok(await byId('kit-test-semen').count() === 0 && await sees('Not on your list: Semen analysis'), 'Hides a test that is not on her list');
  await byId('kit-unhide').click();
  ok(await byId('kit-test-semen').count() === 1, 'And shows it again');
  ok(await sees('Your clinic\'s own instructions come first'), 'Says her clinic\'s instructions come first');
  await shot('kits-3-tests');
  await byId('kit-irregular').click();
  await p.waitForTimeout(300);
  ok(/clinic will time/.test(await byId('kit-when-fsh').innerText()), 'Irregular cycles: the clinic times cycle-day tests');

  // Notes that mention urgent symptoms go to the urgent screen.
  await byId('back').filter({ visible: true }).click();
  await byId('consult-tile').click();
  await byId('kit-notes').fill('Since the visit I have severe pain and heavy bleeding');
  await byId('kit-notes-save').click();
  ok(await byId('solo-urgent').waitFor({ timeout: 10000 }).then(() => true).catch(() => false), 'Urgent symptoms in notes open the urgent screen');
  await p.getByText('Back to today').click();

  // ---------- Pregnant after treatment (Alex has meds) ----------
  await byId('solo-tab-more').click(); await byId('solo-signout').click();
  await byId('pick-Alex Rivera').click();
  await sees('Hi,', 15000);
  await byId('solo-tab-more').click();
  await byId('stage-change').click(); await byId('settings-stage-pregnant').click(); await byId('settings-save').click();
  await sees('Saved.');
  await byId('solo-tab-today').click();
  await byId('ob-tile').waitFor({ timeout: 10000 });
  ok(true, 'Pregnant: Today has the OB card');
  await byId('ob-tile').click();
  await byId('kit-conceived').fill(day(-40));
  await byId('kit-how-day5').click();
  await byId('kit-due').waitFor();
  ok(/Estimated due date/.test(await byId('kit-due').innerText()) && /weeks/.test(await byId('kit-due').innerText()), 'Due date and weeks from the transfer date');
  await byId('kit-rec-betas').click(); await byId('kit-rec-scans').click();
  ok(await sees('2 of 5'), 'Records checklist counts');
  await byId('kit-med-0').waitFor();
  await byId('kit-last-0').fill(day(10));
  await byId('kit-last-save-0').click();
  ok(await sees('end after'), 'A med\'s last day ends its reminders after it');
  await byId('kit-ob-name').fill('Dr. Ana Reyes'); await byId('kit-ob-save').click();
  await byId('kit-ob-day').fill(day(14)); await byId('kit-ob-time').fill('09:00'); await byId('kit-ob-add').click();
  ok(await sees('Added to your visits'), 'First OB appointment added');
  await byId('kit-share-meds').click(); // results only
  await byId('kit-share').click();
  await byId('kit-share-url').waitFor();
  const url = (await byId('kit-share-url').innerText()).trim();
  await shot('kits-4-ob');
  const o = await b.newPage(); await o.goto(url);
  ok(await o.getByText('Estimated due date').count() > 0 && await o.getByText('Dr. Ana Reyes').count() > 0, 'The OB sees the due date and her OB');
  ok(await o.getByText(/Added by the patient|Read from her document/).count() > 0, 'Each item says who entered it');
  ok(await o.getByText('Medications', { exact: true }).count() === 0, 'Only what she chose (no meds)');
  await o.screenshot({ path: D + 'kits-5-summary.png', fullPage: true });
  await byId('kit-share-stop-0').click();
  await p.waitForTimeout(800);
  await o.reload();
  ok(await o.getByText("This link isn't available").count() === 1, 'Stopped link no longer opens');
  await o.close();

  await byId('kit-moved').click();
  ok(await sees('Today is lighter now'), 'Moved to her OB');
  await byId('back').filter({ visible: true }).click();
  await sees("You're with your OB now");
  let light = false; for (let i = 0; i < 20 && !light; i++) { light = await byId('next-payment').count() === 0 && await byId('tile-numbers').count() === 0; if (!light) await p.waitForTimeout(250); }
  ok(light, 'Light Today: no payments or numbers');
  ok(await byId('tile-meds').count() + await byId('now').count() > 0 || await sees('MEDS', 2000), 'Light Today: meds stay');
  await shot('kits-6-light');

  ok(errs.length === 0, 'No page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close();
})();

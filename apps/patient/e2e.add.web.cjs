// Phone app, on your own: adding things yourself, voice that never sticks, sharing visits to someone
// else's calendar, and date fields that fit narrow phones. Run with APP=http://localhost:3000/phone.
const { chromium } = require('playwright');
const SERVER = 'http://localhost:3000', APP = process.env.APP ?? 'http://localhost:8081';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 320, height: 700 }, deviceScaleFactor: 2 });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  const D = require('os').tmpdir() + '/kinpath-phone-shots/'; require('fs').mkdirSync(D, { recursive: true });
  const shot = n => p.screenshot({ path: D + n + '.png' });
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  const byId = id => p.locator(`[data-testid="${id}"]`);
  const sees = async (s, t = 10000) => { try { await p.getByText(s, { exact: false }).filter({ visible: true }).first().waitFor({ timeout: t }); return true; } catch { return false; } };
  const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  // A fake recognizer that never starts, like Safari after the microphone prompt.
  await p.addInitScript(() => { window.webkitSpeechRecognition = function () { this.start = () => {}; this.stop = () => {}; this.abort = () => {}; }; });

  { const w = await b.newPage(); await w.goto(SERVER + '/'); await w.click('button:has-text("Reset demo data")'); await w.waitForTimeout(1500); await w.close(); }
  await p.goto(APP + '/');
  await byId('pick-Alex Rivera').click();
  await sees('Hi,', 15000);

  // Add it yourself: an appointment.
  await byId('solo-tab-add').click();
  ok(await byId('plus-menu').waitFor({ timeout: 5000 }).then(() => true, () => false) && await byId('menu-camera').count() === 1, 'The + menu opens, with Camera first');
  ok(['camera','upload','say','type'].every(Boolean) && await byId('plus-menu').locator('[data-testid^="menu-"]').count() === 4, 'The + menu has four choices');
  await byId('menu-type').click(); await byId('add-hand-appointment').filter({ visible: true }).click();
  const inside = async (id) => { const box = await byId(id).boundingBox(); const card = await byId(id).locator('xpath=ancestor::div[contains(@style,"border-radius")][1]').boundingBox(); return box && box.x + box.width <= 320 && (!card || box.x + box.width <= card.x + card.width + 1); };
  ok(await inside('f-date') && await inside('f-time'), 'Date and time fields fit a 320px-wide phone');
  await byId('f-title').fill('Saline ultrasound');
  await byId('f-date').fill(day(4)); await byId('f-time').fill('09:15');
  await shot('add-1-appointment');
  await byId('byhand-save').click();
  await byId('byhand-calshare').waitFor();
  ok(true, 'After saving a visit: offer to put visits on someone else\'s calendar');
  await byId('byhand-calshare-label').fill('Jordan');
  await byId('byhand-calshare-make').click();
  await byId('byhand-calshare-url').waitFor();
  const url = (await byId('byhand-calshare-url').innerText()).trim();
  const ics = await (await fetch(url)).text();
  ok(/BEGIN:VCALENDAR/.test(ics) && /SUMMARY:Appointment/.test(ics) && !/Saline/.test(ics), 'Their calendar feed works and hides what visits are for');
  await shot('add-2-share');
  await byId('byhand-done').click();

  // Settings lists who has a link, and stops one.
  await byId('solo-tab-more').click();
  await byId('calshare').scrollIntoViewIfNeeded();
  ok(await byId('calshare').getByText('Jordan').first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false), 'Settings shows who her visits are shared with');
  await byId('calshare-stop-0').click();
  await p.waitForTimeout(800);
  ok((await fetch(url)).status === 404, 'Stopping it ends their feed');

  // Medication names suggest as she types, forgiving spelling.
  await byId('solo-tab-add').click(); await byId('menu-type').click(); await byId('add-hand-medication').filter({ visible: true }).click();
  await byId('f-name').fill('folistim');
  await byId('med-suggestions').waitFor({ timeout: 5000 });
  ok((await byId('med-suggestions').innerText()).includes('Follistim AQ'), 'Misspelled "folistim" suggests Follistim AQ');
  await byId('med-suggest-0').click();
  ok(await byId('f-name').inputValue() === 'Follistim AQ' && await byId('med-suggestions').count() === 0, 'Tapping a suggestion fills the name');
  while (await byId('sheet-close').filter({ visible: true }).count()) { await byId('sheet-close').filter({ visible: true }).last().click(); await p.waitForTimeout(400); }

  // Camera from the + menu: the photo goes straight to Pumpkin to read.
  await byId('solo-tab-add').click();
  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), byId('menu-camera').click()]);
  ok(await chooser.element().getAttribute('capture') === 'environment', 'Camera opens the back camera on a phone');
  await chooser.setFiles({ name: 'label.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
  ok(await byId('add-say').filter({ visible: true }).waitFor({ timeout: 15000 }).then(() => true, () => false), 'The Add sheet opens to read the photo');
  while (await byId('sheet-close').filter({ visible: true }).count()) { await byId('sheet-close').filter({ visible: true }).last().click(); await p.waitForTimeout(400); }

  // Upload it: one picker for photos or files.
  await byId('solo-tab-add').click();
  const [up] = await Promise.all([p.waitForEvent('filechooser'), byId('menu-upload').click()]);
  const accept = await up.element().getAttribute('accept');
  ok(/image/.test(accept) && /pdf/.test(accept), 'Upload it takes a photo or a PDF from one picker');
  await up.setFiles([]);
  await p.keyboard.press('Escape');

  // Voice: a recognizer that never starts doesn't freeze the screen.
  await byId('solo-tab-add').click();
  await byId('menu-say').click();
  await byId('say-start').click();
  ok(await sees("Speech didn't start", 12000), 'Voice that never starts lets go with a plain message');
  await byId('say-text').fill('Blood work Thursday at 7:30 am');
  ok(await byId('say-send').isEnabled(), 'And she can still type and send');

  // The test calendar's date field fits too.
  while (await byId('sheet-close').filter({ visible: true }).count()) { await byId('sheet-close').filter({ visible: true }).last().click(); await p.waitForTimeout(400); }
  await byId('solo-tab-more').click();
  await byId('stage-change').click(); await byId('settings-stage-just_starting').click(); await byId('settings-save').click();
  await sees('Saved.');
  await byId('solo-tab-today').click();
  await byId('tests-tile').click();
  ok(await inside('kit-day1'), 'Cycle day 1 field fits the card');
  await shot('add-3-tests');

  ok(errs.length === 0, 'No page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close();
})();

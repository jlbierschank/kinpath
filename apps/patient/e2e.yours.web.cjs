// Phone app: "Make Pumpkin yours", "How Pumpkin talks to me", community name, visit summary.
// Start the server (KINPATH_DEV_LOGIN=1) and the app (APP=... or Expo web on 8081), then run with Playwright.
const { chromium } = require('playwright');
const SERVER = 'http://localhost:3000', APP = process.env.APP ?? 'http://localhost:8081';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const D = require('os').tmpdir() + '/kinpath-phone-shots/'; require('fs').mkdirSync(D, { recursive: true });
  const shot = n => p.screenshot({ path: D + n + '.png', fullPage: false });
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  const byId = id => p.locator(`[data-testid="${id}"]`);
  const text = s => p.getByText(s, { exact: false });
  const sees = async (s, t = 10000) => { try { await text(s).first().waitFor({ timeout: t }); return true; } catch { return false; } };
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', month: '2-digit', day: '2-digit' }).format(new Date()); // MM-DD
  { const w = await b.newPage(); await w.goto(SERVER + '/'); await w.click('button:has-text("Reset demo data")'); await w.waitForTimeout(1500); await w.close(); }

  await p.goto(APP + '/');
  await byId('pick-Alex Rivera').click();
  ok(await sees('Hi, Alex.', 15000), 'Today greets her by name');
  ok(await byId('make-yours').count() === 1, 'Today offers "Make Pumpkin yours"');
  await byId('make-yours').click();

  // Name and pronouns.
  await byId('about-preferred').fill('Lex');
  await byId('pronouns-they/them').click();
  await byId('about-name-save').click();
  ok(await sees('Pumpkin will use your name'), 'Saves her name and pronouns');

  // Identity and health answers wait for her OK.
  await byId('path-solo_by_choice').click();
  await byId('path-donor_sperm').click();
  ok(await byId('about-path-save').isDisabled(), 'Family answers can\'t be saved before she says OK');
  await byId('about-ok').click();
  await byId('about-path-save').click();
  await sees('Saved.');
  await byId('cond-pcos').click();
  await byId('about-background-save').click();
  await p.waitForTimeout(500);
  ok(await byId('about-error').count() === 0, 'Background saved after her OK');
  await shot('yours-1-about');
  await p.getByText('Done', { exact: true }).click();

  // How Pumpkin talks to me.
  await byId('solo-tab-more').click();
  await byId('more-talk').click();
  await byId('tone-reassure').click(); await sees('Saved.');
  await byId('reveal-toggle').click(); await p.waitForTimeout(500);
  await byId('quiet-date').fill(today);
  await byId('quiet-label').fill('A hard day');
  await byId('mode-gentle').click();
  await byId('quiet-add').click();
  ok(await sees('every year'), 'Adds a gentle date for every year');
  await shot('yours-2-talk');
  await p.getByText('Done', { exact: true }).click();
  ok(await sees('Hi, Lex.'), 'Today uses her chosen name');
  ok(await sees('Thinking of you today.'), 'A gentle day softens Today');
  ok(await byId('make-yours').count() === 0 && await text('Want your clinic on Pumpkin?').count() === 0, 'No nudges on a gentle day');
  ok(await sees("here when you're ready"), 'New numbers wait until she taps');
  await shot('yours-3-gentle-today');
  await byId('reveal-results').click();
  ok(await sees('YOUR LATEST NUMBERS'), '"Show me" reveals them');

  // Pause, then come back.
  await byId('solo-tab-more').click();
  await byId('more-talk').click();
  await byId('pause-3').click(); await sees('Paused for 3 days.');
  await p.getByText('Done', { exact: true }).click();
  ok(await sees('Paused until'), 'Today shows the pause');
  ok(await byId('today-add').count() === 0, 'Quiet: only what she needs');
  await shot('yours-4-paused');
  await p.getByText("I'm back").click();
  ok(await sees('Got something new?'), "\"I'm back\" brings Today back");

  // Visit help.
  await byId('solo-tab-record').click();
  await byId('question-ideas').waitFor();
  ok(await sees('PCOS'), 'Suggests a question for her background');
  ok(await sees('sperm donor'), 'Suggests a question for her path');
  await byId('open-summary').click();
  await byId('summary').waitFor();
  ok(await byId('summary').getByText('Lex').count() > 0 && await byId('summary').getByText('PCOS').count() > 0, 'Visit summary has her name and background');
  ok(await byId('summary').getByText('Follistim 200 IU at 20:00').count() === 1, 'And her meds');
  await shot('yours-5-summary');

  // Community name.
  await byId('back').click();
  await byId('solo-tab-more').click();
  await byId('more-alias').click();
  await byId('alias').fill('Alex Rivera');
  await byId('alias-save').click();
  ok(await sees("doesn't include your real name"), 'Community name can\'t be her real name');
  await byId('alias').fill('Marigold Moon');
  await byId('alias-save').click();
  ok(await sees('Your community name is saved.'), 'Community name saved');
  await shot('yours-6-alias');

  ok(errs.length === 0, 'No page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close();
})();

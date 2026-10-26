// Web check of inviting a support person. Start the server (pnpm dev:clinic) and the app on web (pnpm dev:patient, press w), then run with Playwright installed.
const { chromium } = require('playwright');
const APP = process.env.APP_URL ?? 'http://localhost:8081/';
const SERVER = process.env.SERVER_URL ?? 'http://localhost:3000/';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const D = require('os').tmpdir() + '/kinpath-invite-shots/'; require('fs').mkdirSync(D, { recursive: true });
  const shot = n => p.screenshot({ path: D + n + '.png', fullPage: true });
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  const byId = id => p.locator(`[data-testid="${id}"]`);
  const sees = s => p.getByText(s, { exact: false }).first().waitFor({ timeout: 10000 }).then(() => true, () => false);
  const as = async (name) => { await p.evaluate(() => { try { localStorage.clear(); } catch {} }).catch(() => {}); await p.goto(APP); await byId(`pick-${name}`).click(); };
  // Dev outbox: where sign-in and confirmation codes land until a texting/email service is connected.
  const codeFor = async (to) => { const o = await b.newPage(); await o.goto(SERVER + 'dev/outbox'); const rows = await o.locator('[data-testid=outbox-row]').allInnerTexts(); await o.close(); const r = rows.find((x) => x.includes(to) && /\b\d{6}\b/.test(x)); return r.match(/\b(\d{6})\b/)[1]; };

  const web = await b.newPage();
  await web.goto(SERVER); await web.click('button:has-text("Reset demo data")'); await web.waitForTimeout(1500);

  // Maya invites her mom and shares only her cycle
  await as('Maya Torres');
  await byId('avatar').click();
  ok(await sees('Your support people'), 'Settings lists her support people');
  await byId('invite-someone').click();
  await byId('invite-person-name').fill('Rosa Torres');
  await byId('rel-family').click();
  await byId('invite-contact').fill('rosa@example.com');
  await byId('invite-share-meds').click();
  await shot('1-invite-form');
  await byId('create-invite').click();
  await byId('invite-made-code').waitFor({ timeout: 10000 });
  const code = (await byId('invite-made-code').innerText()).trim();
  ok(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code), `Invite code created (${code})`);
  await p.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await byId('copy-code').click();
  ok(await sees('Copied ✓'), 'Copy button copies the code');
  ok((await p.evaluate(() => navigator.clipboard.readText())) === code, 'Clipboard holds just the code');
  ok(await sees('Email Rosa'), 'Main button goes straight to Rosa’s email');
  await shot('2-invite-code');
  await p.getByText('Done', { exact: true }).click();
  ok(await sees('waiting for them to join'), 'The invite shows as waiting');
  await shot('3-pending');

  // Rosa joins with the code
  await p.goto(APP);
  await byId('have-code').click();
  await byId('invite-code').fill(code.toLowerCase());
  await byId('invite-name').fill('Rosa Torres');
  await shot('4-join');
  await byId('join').click();
  ok(await sees("Confirm it's you"), 'Rosa is asked to confirm her email first');
  await shot('4b-confirm');
  await byId('signin-code').fill(await codeFor('rosa@example.com'));
  await byId('join-confirm').click();
  ok(await sees('Hi Rosa.'), 'Rosa joins and lands on her own home screen');
  ok(await sees('Supporting Maya'), 'She is supporting Maya');
  ok((await byId('shared-list').innerText()) === 'Her cycle', 'She sees only Maya’s cycle');
  ok(await byId('help-tonight').count() === 0, 'No injection details, because Maya didn’t share them');
  ok(await p.getByText('Want me to do the injection?').count() === 0 && await p.getByText('Thinking of you today').count() === 1, 'Her quick notes don’t mention injections');
  await shot('5-rosa-home');

  // The code can't be reused
  await p.evaluate(() => { try { localStorage.clear(); } catch {} });
  await p.goto(APP);
  await byId('have-code').click();
  await byId('invite-code').fill(code);
  await byId('invite-name').fill('Someone Else');
  await byId('join').click();
  ok(await sees("That code didn't work"), 'A used code is refused');
  await p.evaluate(() => { try { localStorage.clear(); } catch {} });

  // Maya sees Rosa connected, and removes Jordan
  await as('Maya Torres');
  ok((await byId('bell-count').innerText()) === '1', 'Maya’s bell shows a new notification');
  await byId('bell').click();
  ok(await sees('Rosa accepted your invite.'), 'Her inbox says Rosa accepted');
  await shot('6a-maya-inbox');
  await byId('notification').first().click(); await p.waitForTimeout(800);
  ok(await sees('Sharing with Rosa'), 'Tapping it opens her support people, where Rosa now appears');
  await byId('remove-Jordan').click();
  ok(await sees('Tap again to remove Jordan'), 'Removing asks for a second tap');
  await byId('remove-Jordan').click();
  await p.waitForTimeout(1200);
  ok(await p.getByText('Sharing with Jordan').count() === 0, 'Jordan is off her list');
  await shot('6-maya-people');

  await as('Jordan Torres');
  ok(await sees('Nothing shared right now'), 'Jordan loses access right away');

  console.log('errors:', JSON.stringify(errs));
  console.log('shots:', D);
  await b.close();
})();

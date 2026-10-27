// Phone app: sign in with a one-time code, notification settings, sign out.
// Start the server (KINPATH_DEV_LOGIN=1) and the app on web, then run with Playwright installed.
const { chromium } = require('playwright');
const APP = process.env.APP_URL ?? (process.env.APP ? process.env.APP + '/' : 'http://localhost:8081/');
const SERVER = (process.env.SERVER_URL ?? 'http://localhost:3000').replace(/\/$/, '');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const D = require('os').tmpdir() + '/kinpath-signin-shots/'; require('fs').mkdirSync(D, { recursive: true });
  const shot = (n) => p.screenshot({ path: D + n + '.png', fullPage: true });
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  const byId = (id) => p.locator(`[data-testid="${id}"]`);
  const sees = (s) => p.getByText(s, { exact: false }).first().waitFor({ timeout: 10000 }).then(() => true, () => false);
  const codeFor = async (to) => { const o = await b.newPage(); await o.goto(SERVER + '/dev/outbox'); const rows = await o.locator('[data-testid=outbox-row]').allInnerTexts(); await o.close(); return rows.find((x) => x.includes(to) && /\b\d{6}\b/.test(x)).match(/\b(\d{6})\b/)[1]; };

  const web = await b.newPage(); await web.goto(SERVER + '/'); await web.click('button:has-text("Reset demo data")'); await web.waitForTimeout(1500);

  await p.goto(APP); await p.evaluate(() => localStorage.clear()); await p.goto(APP);
  ok(await sees('Welcome.'), 'The app opens on sign-in');
  await shot('s1-welcome');
  await byId('signin-identifier').fill('maya@example.com');
  await byId('signin-send').click();
  ok(await sees('we sent a 6-digit code'), 'It sends a code');
  await byId('signin-code').fill('000000'); await byId('signin-verify').click();
  ok(await sees("That code didn't work"), 'A wrong code is refused');
  await byId('signin-code').fill(await codeFor('maya@example.com'));
  await shot('s2-code');
  await byId('signin-verify').click();
  ok(await sees('Others ask this on day 6'), 'Maya is signed in to her home screen');

  await p.reload(); await p.waitForTimeout(1500);
  ok(await sees('Others ask this on day 6'), 'She stays signed in after closing and reopening');

  await byId('avatar').click();
  await byId('open-notif-settings').click();
  ok(await sees('Replies from your care team'), 'Notification settings list her alerts');
  await byId('notif-nurse_reply-email').click(); await p.waitForTimeout(800);
  await byId('quiet-hours').click(); await p.waitForTimeout(800);
  await shot('s3-notif-settings');
  await p.goto(APP); await p.waitForTimeout(1500);
  await byId('avatar').click(); await byId('open-notif-settings').click(); await p.waitForTimeout(800);
  const on = (id) => p.locator(`[data-testid="${id}"] input`).first().isChecked();
  ok(await on('notif-nurse_reply-email') && await on('quiet-hours'), 'Her choices are saved');

  await p.goto(APP); await p.waitForTimeout(1200);
  await byId('avatar').click();
  await byId('sign-out').click();
  ok(await sees('Welcome.'), 'Sign out returns to sign-in');
  await p.reload(); await p.waitForTimeout(1200);
  ok(await sees('Welcome.'), 'And stays signed out');

  console.log('errors:', JSON.stringify(errs));
  console.log('shots:', D);
  await b.close();
})();

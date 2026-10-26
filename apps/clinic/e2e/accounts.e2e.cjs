// Real sign-in, your account, team and notifications in the clinic web app.
// Start the server with KINPATH_DEV_LOGIN=1 (or pnpm dev), then run with Playwright installed.
const { chromium } = require('playwright');
const crypto = require('crypto');
const S = (process.env.SERVER_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const PW = 'bayside demo 2026';

// Authenticator-app code (RFC 6238), so the test can do two-step sign-in like a phone would.
const b32 = (s) => { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, v = 0; const out = []; for (const c of s.replace(/\s/g, '')) { v = (v << 5) | A.indexOf(c); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };
const totp = (secret) => { const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000))); const h = crypto.createHmac('sha1', b32(secret)).update(buf).digest(); const o = h[h.length - 1] & 15; return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0'); };

(async () => {
  const b = await chromium.launch();
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  const D = require('path').join(__dirname, '..', '.data', 'accounts-shots') + '/'; require('fs').mkdirSync(D, { recursive: true });
  const errs = [];
  const fresh = async () => { const c = await b.newContext({ viewport: { width: 1200, height: 900 } }); const p = await c.newPage(); p.on('pageerror', (e) => errs.push(e.message)); return p; };
  const sees = (p, s) => p.getByText(s, { exact: false }).first().waitFor({ timeout: 10000 }).then(() => true, () => false);
  const submit = async (p, loc) => { const prev = p.url(); await loc.click(); await p.waitForURL((u) => u.toString() !== prev, { timeout: 10000 }); await p.waitForLoadState('networkidle'); };
  const outbox = async () => { const o = await fresh(); await o.goto(S + '/dev/outbox'); const rows = await o.locator('[data-testid=outbox-row]').allInnerTexts(); await o.context().close(); return rows; };
  const staffSignIn = async (p, email, secret) => {
    await p.goto(S + '/login'); await p.fill('#email', email); await p.fill('#password', PW);
    await submit(p, p.locator('button:has-text("Continue")'));
    if (!secret) secret = (await p.locator('[data-testid=totp-secret]').innerText()).replace(/\s/g, '');
    await p.fill('#code', totp(secret));
    await submit(p, p.locator('button[type=submit]').filter({ hasText: /Turn on two-step|Sign in/ }));
    return secret;
  };

  const r = await fresh(); await r.goto(S + '/'); await r.click('button:has-text("Reset demo data")'); await r.waitForTimeout(1500); await r.context().close();

  // ---- Staff sign-in with two-step ----
  const maria = await fresh();
  await maria.goto(S + '/login'); await maria.fill('#email', 'maria@bayside.example'); await maria.fill('#password', 'wrong password!!');
  await submit(maria, maria.locator('button:has-text("Continue")'));
  ok(await sees(maria, "That email and password don't match."), 'A wrong password is refused in plain words');
  await maria.screenshot({ path: D + 'a1-login.png' });
  await maria.fill('#email', 'maria@bayside.example'); await maria.fill('#password', PW);
  await submit(maria, maria.locator('button:has-text("Continue")'));
  ok(await sees(maria, 'Set up two-step sign-in'), 'First sign-in asks Maria to set up two-step');
  ok(await maria.locator('svg').count() > 0, 'With a QR code for her authenticator app');
  await maria.screenshot({ path: D + 'a2-two-step-setup.png', fullPage: true });
  const secret = (await maria.locator('[data-testid=totp-secret]').innerText()).replace(/\s/g, '');
  await maria.goto(S + '/nurse'); await maria.waitForLoadState('networkidle');
  ok(maria.url().includes('/login/two-step'), 'She can’t reach the queue until two-step is done');
  await maria.fill('#code', totp(secret));
  await submit(maria, maria.locator('button:has-text("Turn on two-step")'));
  ok(await sees(maria, "Two-step sign-in is on"), 'Two-step is on and she lands on her queue');

  // ---- Your account ----
  await maria.click('[data-testid=account-menu]'); await maria.click('a:has-text("Your account")'); await maria.waitForLoadState('networkidle');
  await maria.fill('#title', 'Lead IVF nurse');
  await submit(maria, maria.locator('button:has-text("Save profile")'));
  ok(await sees(maria, 'Profile saved.'), 'She updates her profile');
  await maria.screenshot({ path: D + 'a3-profile.png', fullPage: true });
  await maria.click('a:has-text("Sign-in and security")'); await maria.waitForLoadState('networkidle');
  ok(await sees(maria, 'This device') && await sees(maria, 'Two-step sign-in'), 'Security shows her devices and two-step status');
  await maria.screenshot({ path: D + 'a4-security.png', fullPage: true });
  await maria.click('.tabs a:has-text("Notifications")'); await maria.waitForLoadState('networkidle');
  await maria.uncheck('input[name="urgent_message.push"]'); await maria.uncheck('input[name="urgent_message.sms"]'); await maria.uncheck('input[name="urgent_message.email"]');
  await submit(maria, maria.locator('button:has-text("Save notification settings")'));
  ok(await sees(maria, 'at least one way to reach you outside the app'), 'Urgent alerts can’t be switched off entirely');
  await maria.uncheck('input[name="new_message.push"]'); await maria.check('input[name="new_message.email"]');
  await maria.check('input[name="quiet_on"]');
  await submit(maria, maria.locator('button:has-text("Save notification settings")'));
  ok(await sees(maria, 'Notification settings saved.'), 'She chooses email for new messages and turns on quiet hours');
  ok(!(await maria.locator('input[name="new_message.push"]').isChecked()) && await maria.locator('input[name="new_message.email"]').isChecked(), 'Her choices stick');
  await maria.screenshot({ path: D + 'a5-notification-settings.png', fullPage: true });

  // ---- Patient signs in on the web with a code, then sends an urgent message ----
  const maya = await fresh();
  await maya.goto(S + '/login?tab=code'); await maya.fill('#identifier', 'maya@example.com');
  await submit(maya, maya.locator('button:has-text("Send me a code")'));
  ok(await sees(maya, 'we sent a 6-digit code'), 'Maya asks for a code');
  const code = (await outbox()).find((x) => x.includes('maya@example.com') && /\b\d{6}\b/.test(x)).match(/\b(\d{6})\b/)[1];
  await maya.fill('#code', code);
  await submit(maya, maya.locator('button:has-text("Sign in")'));
  ok(maya.url().includes('/patient'), 'Maya signs in with the code, no password');
  await maya.fill('textarea[name=text]', 'I have chest pain'); await maya.click('button:has-text("Send")'); await maya.waitForTimeout(1500);

  // ---- Maria's bell ----
  await maria.goto(S + '/nurse'); await maria.waitForLoadState('networkidle');
  ok((await maria.locator('[data-testid=bell-count]').innerText()) === '1', 'Maria’s bell shows 1');
  await maria.click('[data-testid=bell]'); await maria.waitForLoadState('networkidle');
  ok(await sees(maria, 'Maya Torres · urgent symptom: call now'), 'The notification says who and why');
  await maria.screenshot({ path: D + 'a6-notifications.png', fullPage: true });
  await submit(maria, maria.locator('button:has-text("Open")').first());
  ok(maria.url().includes('/nurse/'), 'Opening it goes straight to the message');
  const out = (await outbox()).join('\n');
  ok(/URGENT: a patient needs a call now/.test(out) && !/chest/i.test(out), 'The urgent text/push carries no health details');

  // ---- Admin: Team ----
  const kara = await fresh();
  await staffSignIn(kara, 'kara@bayside.example');
  await kara.goto(S + '/admin/team'); await kara.waitForLoadState('networkidle');
  ok(await sees(kara, 'Maria Lopez, RN') && await sees(kara, 'Two-step on'), 'Kara sees the team and who has two-step');
  await kara.fill('#name', 'Tess Nguyen, RN'); await kara.fill('#email', 'tess@bayside.example');
  await submit(kara, kara.locator('button:has-text("Send invite")'));
  ok(await sees(kara, 'Invited. Tess will get an email'), 'Kara invites a new nurse');
  await kara.screenshot({ path: D + 'a7-team.png', fullPage: true });
  const link = (await outbox()).find((x) => x.includes('tess@bayside.example')).match(/https?:\/\/\S+\/login\/setup\?t=[A-Za-z0-9_-]+/)[0];
  const tess = await fresh();
  await tess.goto(link); await tess.fill('#password', 'violet harbor lantern'); await tess.fill('#confirm', 'violet harbor lantern');
  await submit(tess, tess.locator('button:has-text("Set password")'));
  ok(await sees(tess, 'Set up two-step sign-in'), 'Tess sets her password, then two-step');
  const tsecret = (await tess.locator('[data-testid=totp-secret]').innerText()).replace(/\s/g, '');
  await tess.fill('#code', totp(tsecret)); await submit(tess, tess.locator('button:has-text("Turn on two-step")'));
  ok(tess.url().includes('/nurse'), 'Tess is in, on the queue');

  await kara.goto(S + '/admin/team'); await kara.waitForLoadState('networkidle');
  await submit(kara, kara.locator('[data-testid="member-tess@bayside.example"] button:has-text("Deactivate")'));
  ok(await sees(kara, 'Deactivated. They were signed out everywhere'), 'Kara deactivates Tess');
  await tess.goto(S + '/nurse'); await tess.waitForLoadState('networkidle');
  ok(tess.url().includes('/login'), 'Tess is signed out immediately');
  await kara.locator('[data-testid="member-maria@bayside.example"] select').selectOption('physician');
  await submit(kara, kara.locator('[data-testid="member-maria@bayside.example"] button:has-text("Save")'));
  ok(await sees(kara, 'Role changed'), 'Kara changes a role');

  // ---- Sign out ----
  await maria.click('[data-testid=account-menu]'); await submit(maria, maria.locator('.pop button:has-text("Sign out")'));
  ok(maria.url().includes('/login'), 'Sign out works');

  console.log('errors:', JSON.stringify(errs));
  console.log('shots:', D);
  await b.close();
})();

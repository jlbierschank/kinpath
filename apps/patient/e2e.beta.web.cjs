// The beta test build (KINPATH_TEST_MODE=1): plain Pumpkin, test banner, invite your person, feedback, home-screen install.
// Start the server with KINPATH_DEV_LOGIN=1 KINPATH_TEST_MODE=1 KINPATH_TEAM_EMAIL=team@thepumpkin.ai, then run with Playwright.
const { chromium } = require('playwright');
const SERVER = 'http://localhost:3000', APP = process.env.APP ?? SERVER + '/phone';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const D = require('os').tmpdir() + '/kinpath-phone-shots/'; require('fs').mkdirSync(D, { recursive: true });
  const shot = n => p.screenshot({ path: D + n + '.png', fullPage: false });
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  const byId = id => p.locator(`[data-testid="${id}"]`);
  const text = s => p.getByText(s, { exact: false });
  const sees = async (s, t = 10000) => { try { await text(s).filter({ visible: true }).first().waitFor({ timeout: t }); return true; } catch { return false; } };
  const outbox = async () => { const o = await b.newPage(); await o.goto(SERVER + '/dev/outbox'); const rows = await o.locator('[data-testid=outbox-row]').allInnerTexts(); await o.close(); return rows; };
  const codeFor = async (to) => (await outbox()).find((x) => x.includes(to) && /\b\d{6}\b/.test(x)).match(/\b(\d{6})\b/)[1];

  const manifest = await fetch(SERVER + '/phone/manifest.webmanifest');
  ok(manifest.ok && (await manifest.json()).name === 'Pumpkin', 'Home-screen manifest is served');

  await p.goto(APP + '/');
  await byId('test-banner').first().waitFor({ timeout: 15000 });
  ok(await sees('made-up information only'), 'Test banner on the sign-in screen');
  ok(await byId('pick-Maya Torres').count() === 0, 'No demo test people in the test build');
  ok(!(await sees('Bayside', 1500)), 'No demo clinic name');
  await shot('beta-1-signin');

  // Sign up.
  await byId('start-on-my-own').click();
  await byId('stage-in_cycle').click(); await byId('fr-next').click();
  await byId('fr-skip').click(); await byId('fr-skip').click(); await byId('fr-save').click();
  await byId('signup-contact').fill('jess.test@example.com');
  await byId('signup-start').click();
  await byId('signup-code').waitFor();
  await byId('signup-code').fill(await codeFor('jess.test@example.com'));
  await byId('signup-verify').click();
  await byId('signup-first').fill('Jess');
  await byId('signup-finish').click();
  ok(await sees('Hi, Jess.', 15000), 'Signed up');
  ok(await byId('test-banner').count() > 0, 'Banner stays on inside the app');

  // Invite her person.
  await byId('solo-tab-more').click();
  await byId('more-people').click();
  await byId('invite-person').click();
  await byId('invite-person-name').fill('Sam Lee');
  await byId('invite-contact').fill('sam.test@example.com');
  await byId('create-invite').click();
  await byId('invite-made-code').waitFor();
  const code = (await byId('invite-made-code').innerText()).trim();
  ok(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code), 'Invite code made');
  await shot('beta-2-invite');
  await p.getByText('Done', { exact: true }).click();
  ok(await sees('Waiting for them to join'), 'Invite is pending');

  // Feedback.
  await byId('back').click();
  await byId('solo-tab-more').click();
  await byId('more-feedback').click();
  await byId('feedback-screen').fill('Your people');
  await byId('feedback-body').fill('Inviting Sam was easy.');
  await byId('feedback-send').click();
  ok(await sees('Your feedback was sent'), 'Feedback sent');
  ok((await outbox()).some((x) => x.includes('team@thepumpkin.ai') && x.includes('Pumpkin feedback')), 'Team gets the feedback by email');
  await byId('solo-signout').click();

  // Sam joins.
  await byId('have-code').click();
  await byId('invite-code').fill(code);
  await byId('invite-name').fill('Sam Lee');
  await byId('join').click();
  await byId('signin-code').waitFor();
  await byId('signin-code').fill(await codeFor('sam.test@example.com'));
  await byId('join-confirm').click();
  ok(await sees('Jess', 15000), "Sam sees Jess's shared space");
  ok(!(await sees('Bayside', 1500)), 'Partner side says nothing about a demo clinic');
  await shot('beta-3-partner');

  ok(errs.length === 0, 'No page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close();
})();

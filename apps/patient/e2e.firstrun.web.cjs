// The first run on your own: stage, who, plan, something useful, then save with a code.
// Then the two-week wait: result choices, and the quiet switch after a negative.
// Start the server (KINPATH_DEV_LOGIN=1) and the app on web (EXPO_PUBLIC_DEMO=1), then run with Playwright.
const { chromium } = require('playwright');
const SERVER = 'http://localhost:3000', APP = process.env.APP ?? 'http://localhost:8081';
(async () => {
  const b = await chromium.launch();
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  const D = require('os').tmpdir() + '/kinpath-phone-shots/'; require('fs').mkdirSync(D, { recursive: true });
  const codeFor = async (to) => { const o = await b.newPage(); await o.goto(SERVER + '/dev/outbox'); const rows = await o.locator('[data-testid=outbox-row]').allInnerTexts(); await o.close(); return rows.find((x) => x.includes(to) && /\b\d{6}\b/.test(x)).match(/\b(\d{6})\b/)[1]; };

  // Someone trying on her own sees the guideline before giving any details, and can come back to it.
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }); const p = await ctx.newPage();
    const byId = (id) => p.locator(`[data-testid="${id}"]`);
    await p.goto(APP + '/'); await byId('start-on-my-own').click();
    ok((await byId('fr-progress').innerText()).includes('1 of 4'), 'Starts with where she is, before any sign-up');
    ok(await byId('fr-next').isDisabled(), 'Needs a stage to go on');
    await byId('stage-trying').click(); await byId('fr-next').click();
    await byId('who-just_me').click(); await byId('fr-next').click();
    await byId('fr-skip').click();
    ok(await byId('fr-guideline').count() === 1, 'Trying on my own: when people usually see a specialist');
    await p.screenshot({ path: D + 'firstrun-1-trying.png', fullPage: true });
    await p.reload(); await byId('start-on-my-own').click();
    ok(await byId('fr-guideline').count() === 1, 'Coming back later picks up where she left off, on this phone');
    await ctx.close();
  }

  // Two-week wait: answers saved with her OK, the beta date, the result choice, then a negative.
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }); const p = await ctx.newPage();
    const byId = (id) => p.locator(`[data-testid="${id}"]`);
    const sees = async (s, t = 10000) => { try { await p.getByText(s, { exact: false }).filter({ visible: true }).first().waitFor({ timeout: t }); return true; } catch { return false; } };
    { const w = await ctx.newPage(); await w.goto(SERVER + '/'); await w.click('button:has-text("Reset demo data")'); await w.waitForTimeout(1500); await w.close(); }
    await p.goto(APP + '/'); await byId('start-on-my-own').click();
    await byId('stage-two_week_wait').click(); await byId('fr-next').click();
    await byId('who-partner').click(); await byId('fr-next').click();
    await byId('plan-donor_sperm').click(); await byId('fr-keep').click(); await byId('fr-next').click();
    const beta = new Date(Date.now() + 4 * 864e5).toISOString().slice(0, 10);
    await byId('fr-beta').fill(beta);
    await byId('fr-reveal-tap').click();
    await p.screenshot({ path: D + 'firstrun-2-wait.png', fullPage: true });
    await byId('fr-save').click();
    await byId('signup-contact').fill('sam.wait@example.com'); await byId('signup-start').click();
    await byId('signup-code').fill(await codeFor('sam.wait@example.com')); await byId('signup-verify').click();
    await byId('signup-first').fill('Sam'); await byId('signup-finish').click();
    ok(await sees('Hi, Sam.', 15000), 'Signed up and on Today');
    ok(await byId('result-tile').count() === 1, 'The wait leads with her result choices');
    ok(await sees('Pregnancy blood test'), 'Her blood test date is on Today');
    await p.screenshot({ path: D + 'firstrun-3-today.png', fullPage: true });
    await byId('said-negative').click();
    ok(await sees("We're so sorry."), 'A negative gets a quiet, kind answer');
    ok(await sees('Keep taking any medication until your clinic tells you to stop'), 'Never tells her to stop meds');
    await byId('quiet-yes').click();
    ok(await sees('After a hard result'), 'Quiet mode only when she says yes');
    ok(await byId('next-payment').count() === 0 && await byId('make-yours').count() === 0, 'No money or setup nudges after a hard result');
    const about = await p.evaluate(async (server) => { const t = JSON.parse(localStorage.getItem('kinpath.session')).token; const base = location.pathname.startsWith('/phone') ? '' : server; return (await fetch(base + '/api/solo/about', { headers: { Authorization: 'Bearer ' + t } })).json(); }, SERVER);
    ok(about.familyPath.includes('with_partner') && about.familyPath.includes('donor_sperm') && about.revealResults === true, 'Who, plan and result choice were kept, with her OK');
    await ctx.close();
  }
  await b.close();
})();

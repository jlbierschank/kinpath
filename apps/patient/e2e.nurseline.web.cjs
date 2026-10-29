// The after-hours nurse line: if it's missing, the urgent screen lets her add it on the spot.
// Start the server (KINPATH_DEV_LOGIN=1) and the app on web (EXPO_PUBLIC_DEMO=1), then run with Playwright.
const { chromium } = require('playwright');
const SERVER = 'http://localhost:3000', APP = process.env.APP ?? 'http://localhost:8081';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  const byId = id => p.locator(`[data-testid="${id}"]`);
  const sees = async (s, t = 10000) => { try { await p.getByText(s, { exact: false }).filter({ visible: true }).first().waitFor({ timeout: t }); return true; } catch { return false; } };
  { const w = await b.newPage(); await w.goto(SERVER + '/'); await w.click('button:has-text("Reset demo data")'); await w.waitForTimeout(1500); await w.close(); }
  const urgent = async () => {
    await byId('solo-tab-add').click(); await byId('menu-type').click();
    await byId('type-text').fill("I'm bleeding heavily and the pain is severe"); await byId('type-send').click();
    await byId('solo-urgent').waitFor();
  };

  await p.goto(APP + '/');
  await byId('pick-Alex Rivera').click();
  await byId('solo-tab-more').click();
  await byId('settings-phone').fill(''); await p.getByText('Save', { exact: true }).first().click();
  ok(await sees('Saved.'), 'Cleared her after-hours line in Settings');

  await urgent();
  ok(await byId('urgent-phone').isVisible(), 'No number yet: the urgent screen asks for it');
  await byId('urgent-phone').fill('(813) 555-0142'); await byId('urgent-phone-save').click();
  ok(await sees('Call (813) 555-0142'), 'Saving it shows the call button right away');
  ok(await sees('call 911'), '911 is still there');
  await p.getByText('Back to today').click();

  await urgent();
  ok(await sees('Call (813) 555-0142'), 'Next time the number is already there');
  await p.getByText('Back to today').click();
  await byId('solo-tab-more').click();
  ok(await byId('settings-phone').inputValue() === '(813) 555-0142', 'Settings shows the number she added');
  await b.close();
})();

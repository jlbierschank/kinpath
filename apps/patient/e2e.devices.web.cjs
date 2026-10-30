// The same app on a phone, an iPad and a laptop: same shell everywhere, and on a computer with a mouse,
// buttons instead of swipes and no Camera. Run with APP=http://localhost:3000/phone.
const { chromium } = require('playwright');
const SERVER = 'http://localhost:3000', APP = process.env.APP ?? 'http://localhost:8081';
(async () => {
  const b = await chromium.launch();
  const errs = [];
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  const D = require('os').tmpdir() + '/kinpath-phone-shots/'; require('fs').mkdirSync(D, { recursive: true });
  { const w = await b.newPage(); await w.goto(SERVER + '/'); await w.click('button:has-text("Reset demo data")'); await w.waitForTimeout(1500); await w.close(); }
  const DEVICES = [
    ['phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
    ['ipad', { viewport: { width: 1180, height: 820 }, isMobile: true, hasTouch: true }],
    ['laptop', { viewport: { width: 1440, height: 900 } }],
  ];
  for (const [name, opts] of DEVICES) {
    for (const who of ['Alex Rivera', 'Maya Torres']) {
      const p = await b.newPage(opts);
      p.on('pageerror', e => errs.push(e.message));
      const byId = id => p.locator(`[data-testid="${id}"]`).filter({ visible: true });
      await p.goto(APP + '/'); await p.locator(`[data-testid="pick-${who}"]`).click();
      await byId('greeting').waitFor({ timeout: 15000 });
      const bar = await byId('tab-bar').boundingBox();
      const head = await byId('feeling-unwell').count();
      ok(bar && bar.width <= 441 && head === 1, `${name}, ${who.split(' ')[0]}: same header and tab bar, centered`);
      const add = who === 'Alex Rivera' ? 'solo-tab-add' : 'clinic-add';
      await byId(add).click(); await p.waitForTimeout(500);
      if (who === 'Alex Rivera') {
        const cam = await byId('menu-camera').count();
        ok(name === 'laptop' ? cam === 0 : cam === 1, `${name}: Camera ${name === 'laptop' ? 'hidden on a computer' : 'offered'}`);
      }
      await p.keyboard.press('Escape'); await p.waitForTimeout(300);
      await p.screenshot({ path: `${D}device-${name}-${who.split(' ')[0]}.png` });
      if (who === 'Alex Rivera') {
        const tip = await p.getByText('Tip: swipe').filter({ visible: true }).count();
        ok(name === 'laptop' ? tip === 0 : true, `${name}: no swipe tips on a computer`);
        if (name === 'laptop') {
          await byId('solo-tab-more').click();
          await byId('reminders-where').waitFor({ timeout: 8000 }).catch(() => {});
          ok(await byId('reminders-where').count() === 1, 'laptop: You says reminders ring on her phone, through the app');
        }
      }
      await p.close();
    }
  }
  ok(errs.length === 0, 'No page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close();
})();

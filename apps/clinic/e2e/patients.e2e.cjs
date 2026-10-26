// Browser + API check: patients screen, appointments, HL7, upload, FHIR setup, IT guide. Start the app first.
const { chromium } = require('playwright');
const B = process.env.B || 'http://localhost:3000';
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const D = require('path').join(__dirname, '..', '.data', 'patients-shots') + '/'; require('fs').mkdirSync(D, { recursive: true });
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  const shot = (n) => p.screenshot({ path: D + n + '.png', fullPage: true });
  const as = async (name) => { await p.goto(B + '/'); const sw = p.locator('button:has-text("Switch person")'); if (await sw.count()) { await sw.click(); await p.waitForURL(B + '/'); } await p.click(`button:has-text("${name}")`); await p.waitForURL(u => !u.toString().endsWith(':3000/')); await p.locator('text=Who are you testing as?').waitFor({ state: 'detached', timeout: 10000 }); await p.reload(); await p.waitForLoadState('networkidle'); };
  const ymd = (o) => { const d = new Date(); d.setDate(d.getDate() + o); return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d); };

  await p.goto(B + '/'); await p.click('button:has-text("Reset demo data")'); await p.waitForTimeout(1500);

  // ---- Admin: key, HL7, upload, FHIR setup, guide ----
  await as('Kara Diaz');
  await p.goto(B + '/admin/records');
  await p.fill('#name', 'Lab interface'); await p.click('button:has-text("Create key")');
  await p.locator('[data-testid=new-key-value]').waitFor(); const key = (await p.textContent('[data-testid=new-key-value]')).trim();
  const tomorrow = ymd(1).replace(/-/g, '');
  const hl7 = ['MSH|^~\\&|LIS|BAYSIDE|PUMPKIN|BAYSIDE|202610260800||ORU^R01|M-1|P|2.5.1', 'PID|1||BF-100231^^^BAYSIDE^MR||Torres^Maya', `OBR|1||FL-1|||${ymd(0).replace(/-/g, '')}0745`, 'OBX|1|NM|2243-4^Estradiol^LN||401|pg/mL|||||F',
    'MSH|^~\\&|SCHED|BAYSIDE|PUMPKIN|BAYSIDE|202610260800||SIU^S12|M-2|P|2.5.1', 'SCH|PA-7|FA-7', 'PID|1||BF-100231^^^BAYSIDE^MR||Torres^Maya', `AIS|1||C^Follow-up consult with Dr. Patel|${tomorrow}1400`].join('\r');
  let r = await fetch(B + '/api/integrations/records', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'x-application/hl7-v2+er7' }, body: hl7 });
  const ack = await r.text();
  ok(r.status === 200 && /MSA\|AA\|M-1/.test(ack) && /MSA\|AA\|M-2/.test(ack), 'HL7 v2 is accepted with an acknowledgment for each message');
  const csv = require('path').join(D, 'export.csv');
  require('fs').writeFileSync(csv, `result_id,mrn,last_name,test,value,unit,collected_at\nup-1,BF-100231,Torres,FSH,6.1,mIU/mL,${new Date().toISOString()}\n`);
  await p.goto(B + '/admin/records'); await p.setInputFiles('input[type=file]', csv); await p.click('[data-testid=upload]');
  await p.locator('[data-testid=upload-result]').waitFor({ timeout: 10000 });
  ok(/export\.csv: 1 result added \(1 to a nurse first\)/.test(await p.textContent('[data-testid=upload-result]')), 'Uploading an export works (FSH has no range, so a nurse sees it first)');
  await p.click('[data-testid=fhir-setup]'); await p.waitForURL(/saved=/); await p.waitForLoadState('networkidle');
  const jwksUrl = (await p.textContent('[data-testid=jwks-url]')).trim();
  ok(jwksUrl.endsWith('/api/integrations/jwks/bayside'), 'FHIR setup shows the key address to give the vendor');
  const jwks = await (await fetch(jwksUrl)).json();
  ok(jwks.keys?.[0]?.kty === 'RSA' && jwks.keys[0].alg === 'RS384' && !('d' in jwks.keys[0]), 'The key address serves only the public key');
  await shot('p1-admin-records');
  await p.click('[data-testid=guide-link]'); await p.waitForLoadState('networkidle');
  ok(await p.locator(`text=${B}/api/integrations/records`).count() >= 1 && await p.locator(`text=${jwksUrl}`).count() >= 1, 'The IT guide shows this clinic\'s addresses');
  await shot('p2-guide');
  await p.goto(B + '/admin'); ok(await p.locator('td:has-text("Lab interface")').count() >= 1, 'Audit log credits the interface key');

  // ---- Nurse: patients screen ----
  await as('Maria Lopez, RN');
  await p.goto(B + '/patients'); await p.waitForLoadState('networkidle');
  ok(await p.locator('[data-testid=patient-row]').count() === 2, 'Maria sees Bayside\'s two patients');
  await p.fill('#firstName', 'Ana'); await p.fill('#lastName', 'López'); await p.fill('#mrn', 'BF-100300'); await p.fill('#contact', '(813) 555-0199');
  await p.selectOption('#lang', 'es'); await p.selectOption('#cycleKind', 'ivf');
  await p.click('[data-testid=add-patient]'); await p.waitForURL(/saved=/); await p.reload(); await p.waitForLoadState('networkidle');
  ok(await p.locator('text=Ana was added and sent a welcome').count() === 1 && await p.locator('[data-testid=patient-row]').count() === 3, 'She adds Ana López with an IVF cycle');
  await p.selectOption('#bp', { label: 'Ana López' }); await p.selectOption('#bk', 'monitoring');
  await p.fill('#bt', `${ymd(2)}T07:30`); await p.fill('#bl', 'Bayside Tampa');
  await p.click('[data-testid=book]'); await p.waitForURL(/saved=Booked/); await p.reload(); await p.waitForLoadState('networkidle');
  ok(await p.locator('[data-testid=visit-row]:has-text("Ana López")').count() === 1 && await p.locator('[data-testid=visit-row]:has-text("7:30 AM")').count() >= 1, 'She books Ana a 7:30 am visit (clinic time)');
  ok(await p.locator('[data-testid=visit-row]:has-text("Follow-up consult with Dr. Patel")').count() === 1, 'The HL7 appointment for Maya is on the list too');
  await shot('p3-patients');
  await p.goto(B + '/dev/outbox'); ok(await p.locator('text=Bayside Fertility te invitó a Pumpkin').count() >= 1, 'Ana\'s welcome (in Spanish) is in the outbox');

  // ---- Maya sees her visit ----
  const today = await (await fetch(B + '/api/patient/today', { headers: { Authorization: 'Dev 00000000-0000-4000-8000-000000000010' } })).json();
  ok(today.appointments?.some((a) => a.title === 'Follow-up consult with Dr. Patel'), "Maya's app has the visit from the records system");
  await as('Maya Torres'); await p.goto(B + '/patient'); await p.waitForLoadState('networkidle');
  ok(await p.locator('[data-testid=visits]:has-text("Follow-up consult")').count() === 1, 'And it shows on her page');
  const partner = await (await fetch(B + '/api/partner/home', { headers: { Authorization: 'Dev 00000000-0000-4000-8000-000000000011' } })).json();
  ok(partner.appointments?.length === 1, 'Jordan sees it because Maya shares her schedule');
  console.log('errors:', JSON.stringify(errs));
  await b.close();
})();

#!/usr/bin/env node
/**
 * Looks up the RxNorm code (RxCUI) for each medication name Pumpkin suggests, from the National Library
 * of Medicine's RxNav service, and writes a migration that fills med_codes. Run it where the internet
 * is reachable (your Mac), review the output, then commit it:
 *   node scripts/rxnorm-codes.mjs > packages/db/migrations/026_med_codes.sql
 * Brand names map to their brand-name concept (BN); generics to the ingredient (IN). Anything RxNav
 * can't match exactly is listed at the end as a comment for a person to decide, never guessed.
 */
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../packages/core/src/meds.ts", import.meta.url), "utf8");
const names = new Set();
for (const m of src.matchAll(/name: "([^"]+)"(?:, also: "([^"]+)")?(?:, aka: \[([^\]]*)\])?/g)) {
  names.add(m[1]); if (m[2]) names.add(m[2]);
  for (const a of (m[3] ?? "").matchAll(/"([^"]+)"/g)) names.add(a[1]);
}
const today = new Date().toISOString().slice(0, 10);
const rows = [], unmatched = [];
for (const name of names) {
  const r = await fetch(`https://rxnav.nlm.nih.gov/REST/rxcui.json?name=${encodeURIComponent(name)}&search=0`).then((x) => x.json()).catch(() => null);
  const id = r?.idGroup?.rxnormId?.[0];
  if (!id) { unmatched.push(name); continue; }
  const p = await fetch(`https://rxnav.nlm.nih.gov/REST/rxcui/${id}/properties.json`).then((x) => x.json()).catch(() => null);
  const display = p?.properties?.name ?? name;
  rows.push(`  (${q(name.toLowerCase())}, ${q(id)}, ${q(`${display} (${p?.properties?.tty ?? "?"})`)}, ${q(`RxNav, ${today}`)})`);
}
function q(s) { return `'${String(s).replace(/'/g, "''")}'`; }
console.log(`-- RxNorm codes from NLM RxNav (rxnav.nlm.nih.gov), looked up ${today} by scripts/rxnorm-codes.mjs.`);
console.log(`INSERT INTO med_codes (name, rxcui, display, checked) VALUES\n${rows.join(",\n")}\nON CONFLICT (name) DO UPDATE SET rxcui = EXCLUDED.rxcui, display = EXCLUDED.display, checked = EXCLUDED.checked;`);
console.log(`UPDATE med_orders m SET rxnorm = c.rxcui FROM med_codes c WHERE c.name = lower(trim(m.medication)) AND m.rxnorm IS NULL;`);
if (unmatched.length) console.log(`-- No exact RxNorm match (a person decides): ${unmatched.join(", ")}`);

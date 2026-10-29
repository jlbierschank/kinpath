/**
 * Names of medications people commonly take during fertility treatment, for suggestions as she types.
 * Names only: no doses, no advice. She can always type something that isn't here.
 * Brand names are US names; the other name in each entry is the generic (or the brand it's sold as).
 */
export interface MedName { name: string; also?: string; aka?: string[] }

export const COMMON_MEDS: MedName[] = [
  { name: "Gonal-f", also: "follitropin alfa", aka: ["gonal f", "gonalf"] },
  { name: "Follistim AQ", also: "follitropin beta", aka: ["follistim"] },
  { name: "Menopur", also: "menotropins" },
  { name: "Ganirelix", also: "ganirelix acetate", aka: ["fyremadel"] },
  { name: "Cetrotide", also: "cetrorelix" },
  { name: "Ovidrel", also: "choriogonadotropin alfa" },
  { name: "Novarel", also: "hCG" },
  { name: "Pregnyl", also: "hCG" },
  { name: "hCG", also: "human chorionic gonadotropin", aka: ["hcg trigger"] },
  { name: "Leuprolide", also: "Lupron", aka: ["lupron", "lupron trigger"] },
  { name: "Clomiphene", also: "Clomid", aka: ["clomid"] },
  { name: "Letrozole", also: "Femara", aka: ["femara"] },
  { name: "Progesterone in oil", also: "PIO", aka: ["pio", "progesterone injection"] },
  { name: "Progesterone vaginal insert", also: "Endometrin", aka: ["endometrin"] },
  { name: "Progesterone vaginal gel", also: "Crinone", aka: ["crinone"] },
  { name: "Progesterone capsules", also: "Prometrium", aka: ["prometrium"] },
  { name: "Estradiol tablets", also: "Estrace", aka: ["estrace", "estradiol"] },
  { name: "Estradiol valerate", also: "Delestrogen", aka: ["delestrogen", "estradiol injection"] },
  { name: "Estradiol patch", also: "Vivelle-Dot", aka: ["vivelle", "estrogen patch"] },
  { name: "Medroxyprogesterone", also: "Provera", aka: ["provera"] },
  { name: "Norethindrone", also: "Aygestin", aka: ["aygestin"] },
  { name: "Birth control pills", aka: ["ocp", "oral contraceptive"] },
  { name: "Methylprednisolone", also: "Medrol", aka: ["medrol"] },
  { name: "Dexamethasone" },
  { name: "Doxycycline" },
  { name: "Azithromycin" },
  { name: "Metformin" },
  { name: "Cabergoline", also: "Dostinex" },
  { name: "Low-dose aspirin", aka: ["baby aspirin", "aspirin"] },
  { name: "Enoxaparin", also: "Lovenox", aka: ["lovenox"] },
  { name: "Heparin" },
  { name: "Prenatal vitamin", aka: ["prenatal"] },
  { name: "Folic acid", aka: ["folate"] },
  { name: "Vitamin D", aka: ["vitamin d3"] },
  { name: "CoQ10", also: "coenzyme Q10", aka: ["ubiquinol"] },
  { name: "Levothyroxine", also: "Synthroid", aka: ["synthroid"] },
  { name: "Growth hormone", also: "Omnitrope", aka: ["omnitrope", "hgh"] },
];

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Edit distance, capped: enough to forgive a couple of typos ("folistim", "menapur"). */
function close(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]!);
    }
    if (best > max) return false;
    prev = cur;
  }
  return prev[b.length]! <= max;
}

/**
 * Up to `limit` suggestions for what she's typed: names that start with it first, then names that
 * contain it, then near misses for typos. Nothing until she's typed 2 letters, or once it matches exactly.
 */
export function suggestMeds(query: string, limit = 5): MedName[] {
  const q = norm(query);
  if (q.length < 2) return [];
  const scored: { m: MedName; score: number }[] = [];
  for (const m of COMMON_MEDS) {
    const names = [m.name, m.also ?? "", ...(m.aka ?? [])].filter(Boolean).map(norm);
    if (names.some((n) => n === q) && norm(m.name) === q) return [];
    let score = 0;
    if (names.some((n) => n.startsWith(q))) score = 3;
    else if (names.some((n) => n.split(" ").some((w) => w.startsWith(q)) || n.includes(q))) score = 2;
    else if (q.length >= 4 && names.some((n) => close(q, n.slice(0, q.length), q.length >= 7 ? 2 : 1))) score = 1;
    if (score) scored.push({ m, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.m.name.localeCompare(b.m.name)).slice(0, limit).map((x) => x.m);
}

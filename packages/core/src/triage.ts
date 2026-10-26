/**
 * Urgent-symptom triage. Deterministic, and it runs BEFORE any AI sees a message.
 *
 * Rule: if this returns anything other than "routine", the message goes to people
 * (on-call nurse or crisis resources) and the AI does not answer it.
 *
 * It deliberately over-triggers: it ignores negation ("no chest pain" still flags),
 * because a false alarm costs a phone call and a miss can cost a life.
 *
 * CLINICAL CONTENT IS A PLACEHOLDER. An IVF nurse and the clinic's medical director
 * must review and own this list before any real patient uses it.
 */

export type TriageLevel = "routine" | "urgent" | "crisis";

export interface TriageResult {
  level: TriageLevel;
  /** Which rules fired, for the audit log and the nurse's view. */
  ruleIds: string[];
  /** Where the message must go. "none" only when level is routine. */
  routeTo: "none" | "on_call_nurse" | "crisis_resources";
}

interface Rule {
  id: string;
  level: Exclude<TriageLevel, "routine">;
  /** Every group must match at least one of its terms (AND across groups, OR within). */
  allOf: string[][];
}

// Terms are written without accents and in lowercase; input is normalized the same way.
const TERMS = {
  breath: ["short of breath", "shortness of breath", "cant breathe", "can't breathe", "hard to breathe", "trouble breathing", "struggling to breathe", "falta el aire", "me falta el aire", "no puedo respirar", "dificultad para respirar"],
  bloat: ["bloat", "swollen belly", "belly is swollen", "abdomen swollen", "hinchazon", "hinchada", "inflamada"],
  chest: ["chest pain", "pain in my chest", "dolor de pecho", "dolor en el pecho"],
  bleedHeavy: ["soaking a pad", "soaked a pad", "soaking through", "heavy bleeding", "bleeding a lot", "sangrado abundante", "sangrando mucho", "empapando"],
  faint: ["fainted", "passed out", "faint", "desmaye", "me desmaye", "desmayo"],
  severePain: ["severe pain", "worst pain", "unbearable pain", "dolor severo", "dolor muy fuerte", "dolor insoportable"],
  vomit: ["vomiting", "throwing up", "cant keep anything down", "can't keep anything down", "vomitando", "vomitos"],
  lowUrine: ["barely peeing", "not peeing", "very little urine", "casi no orino", "no he orinado"],
  legSwelling: ["swollen leg", "leg is swollen", "calf pain", "pierna hinchada", "dolor en la pantorrilla"],
  fever: ["fever", "fiebre", "temperature of 101", "temperature of 102", "temperature of 103"],
  selfHarm: ["kill myself", "end my life", "suicide", "suicidal", "hurt myself", "dont want to be alive", "don't want to be alive", "matarme", "quitarme la vida", "suicid", "hacerme dano", "no quiero vivir"],
} as const;

const RULES: Rule[] = [
  { id: "crisis.self_harm", level: "crisis", allOf: [[...TERMS.selfHarm]] },
  { id: "urgent.breathing", level: "urgent", allOf: [[...TERMS.breath]] },
  { id: "urgent.chest_pain", level: "urgent", allOf: [[...TERMS.chest]] },
  { id: "urgent.heavy_bleeding", level: "urgent", allOf: [[...TERMS.bleedHeavy]] },
  { id: "urgent.fainting", level: "urgent", allOf: [[...TERMS.faint]] },
  { id: "urgent.severe_pain", level: "urgent", allOf: [[...TERMS.severePain]] },
  { id: "urgent.ohss_bloat_vomit", level: "urgent", allOf: [[...TERMS.bloat], [...TERMS.vomit]] },
  { id: "urgent.ohss_bloat_low_urine", level: "urgent", allOf: [[...TERMS.bloat], [...TERMS.lowUrine]] },
  { id: "urgent.clot_leg", level: "urgent", allOf: [[...TERMS.legSwelling]] },
  { id: "urgent.fever", level: "urgent", allOf: [[...TERMS.fever]] },
];

export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents: "hinchazón" -> "hinchazon"
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** A term a clinic adds on top of the built-in rules. Clinics can add terms but never remove built-ins. */
export interface ClinicTerm { id?: string; term: string; level: "urgent" | "crisis" }

export function triage(message: string, clinicTerms: ClinicTerm[] = []): TriageResult {
  const text = normalize(message);
  const fired: { id: string; level: "urgent" | "crisis" }[] = RULES.filter((rule) => rule.allOf.every((group) => group.some((term) => text.includes(term))));
  for (const ct of clinicTerms) {
    const term = normalize(ct.term);
    if (term.length >= 3 && text.includes(term)) fired.push({ id: `clinic.${term.replace(/[^a-z0-9]+/g, "_")}`, level: ct.level });
  }
  if (fired.some((r) => r.level === "crisis")) {
    return { level: "crisis", ruleIds: fired.map((r) => r.id), routeTo: "crisis_resources" };
  }
  if (fired.length > 0) {
    return { level: "urgent", ruleIds: fired.map((r) => r.id), routeTo: "on_call_nurse" };
  }
  return { level: "routine", ruleIds: [], routeTo: "none" };
}

/** Built-in rules, shown read-only on the clinic's settings page. */
export const BUILT_IN_RULES = RULES.map((r) => ({ id: r.id, level: r.level, allOf: r.allOf.map((g) => [...g]) }));

/** Exposed so tests and the clinic's AI settings page can list every rule. */
export const TRIAGE_RULE_IDS = RULES.map((r) => r.id);

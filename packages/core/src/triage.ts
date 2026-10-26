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
  breath: ["short of breath", "shortness of breath", "cant breathe", "can't breathe", "hard to breathe", "trouble breathing", "struggling to breathe", "catch my breath", "difficulty breathing", "hard time breathing",
    "falta el aire", "me falta el aire", "no puedo respirar", "dificultad para respirar", "me cuesta respirar"],
  bloat: ["bloat", "swollen belly", "belly is swollen", "abdomen swollen", "so swollen", "hinchazon", "hinchada", "inflamada"],
  chest: ["chest pain", "pain in my chest", "chest hurts", "chest pressure", "chest is tight", "tight chest", "dolor de pecho", "dolor en el pecho", "me duele el pecho", "presion en el pecho"],
  bleedHeavy: ["soaking a pad", "soaked a pad", "soaking through", "heavy bleeding", "bleeding heavily", "bleeding a lot", "big clots", "sangrado abundante", "sangrando mucho", "sangro mucho", "empapando"],
  // Not bare "faint": "a faint line on the test" is an everyday IVF question.
  faint: ["fainted", "fainting", "passed out", "going to faint", "feel faint", "feeling faint", "about to faint", "blacked out", "black out", "very dizzy", "so dizzy",
    "desmaye", "me desmaye", "desmayo", "casi me desmayo", "muy mareada", "muy mareado", "casi me caigo"],
  severePain: ["severe pain", "worst pain", "unbearable pain", "pain is unbearable", "excruciating", "doubled over", "pain so bad", "so much pain", "cant stand up", "can't stand up",
    "dolor severo", "dolor muy fuerte", "dolor insoportable", "no me puedo parar"],
  vomit: ["vomiting", "throwing up", "cant keep anything down", "can't keep anything down", "vomitando", "vomitos"],
  vomitPersistent: ["vomiting all day", "cant stop throwing up", "can't stop throwing up", "cant stop vomiting", "can't stop vomiting", "cant keep anything down", "can't keep anything down",
    "no paro de vomitar", "no puedo dejar de vomitar"],
  lowUrine: ["barely peeing", "barely peed", "not peeing", "haven't peed", "havent peed", "very little urine", "casi no orino", "no he orinado"],
  gained: ["gained", "gaining", "subi"],
  weightFast: ["pounds in", "lbs in", "pounds overnight", "kilos en"],
  legSwelling: ["swollen leg", "leg is swollen", "calf is swollen", "swollen calf", "calf pain", "calf hurts", "pierna hinchada", "dolor en la pantorrilla", "me duele la pantorrilla"],
  fever: ["fever", "fiebre", "temperature of 10", "temp of 10", "temp is 10", "temperature is 10", "100.4"],
  throat: ["throat", "garganta"],
  closing: ["closing", "close up", "swelling shut", "cerrando"],
  allergy: ["hives", "lips are swelling", "lips swelling", "face is swelling", "tongue is swelling", "allergic reaction", "ronchas", "se me hincharon los labios", "reaccion alergica"],
  headache: ["headache", "dolor de cabeza"],
  headacheSevere: ["worst", "severe", "sudden", "terrible", "blurry", "vision", "muy fuerte", "borroso", "repentino"],
  vision: ["vision is blurry", "blurry vision", "seeing spots", "see spots", "flashing lights", "veo borroso", "vision borrosa", "veo manchas"],
  infection: ["red and spreading", "spreading redness", "red streak", "pus", "roja y se extiende"],
  heart: ["heart is racing", "heart racing", "racing heart", "heart is pounding", "palpitations", "corazon acelerado", "palpitaciones"],
  selfHarm: ["kill myself", "end my life", "suicide", "suicidal", "hurt myself", "hurting myself", "dont want to be alive", "don't want to be alive", "want to die", "wanna die",
    "better off without me", "want to disappear", "disappear forever", "no reason to live", "point of living", "pills saved", "saved up pills", "overdose",
    "matarme", "quitarme la vida", "suicid", "hacerme dano", "no quiero vivir", "morirme", "quiero morir", "mejor sin mi", "desaparecer para siempre", "no quiero seguir viviendo"],
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
  { id: "urgent.ohss_weight_gain", level: "urgent", allOf: [[...TERMS.gained], [...TERMS.weightFast]] },
  { id: "urgent.persistent_vomiting", level: "urgent", allOf: [[...TERMS.vomitPersistent]] },
  { id: "urgent.clot_leg", level: "urgent", allOf: [[...TERMS.legSwelling]] },
  { id: "urgent.fever", level: "urgent", allOf: [[...TERMS.fever]] },
  { id: "urgent.allergy_throat", level: "urgent", allOf: [[...TERMS.throat], [...TERMS.closing]] },
  { id: "urgent.allergy", level: "urgent", allOf: [[...TERMS.allergy]] },
  { id: "urgent.severe_headache", level: "urgent", allOf: [[...TERMS.headache], [...TERMS.headacheSevere]] },
  { id: "urgent.vision", level: "urgent", allOf: [[...TERMS.vision]] },
  { id: "urgent.injection_infection", level: "urgent", allOf: [[...TERMS.infection]] },
  { id: "urgent.heart", level: "urgent", allOf: [[...TERMS.heart]] },
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

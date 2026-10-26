import { describe, expect, it } from "vitest";
import {
  approveAndSend, canView, classifyMessage, draftFromProtocol, HandoffError, labelResult, markRead, triage,
  type ClinicRange, type Handoff, type PartnerGrant,
} from "../src";

describe("urgent triage runs before any AI", () => {
  const urgent: [string, string][] = [
    ["I'm really bloated and short of breath", "urgent.breathing"],
    ["Tengo mucha hinchazón y me falta el aire", "urgent.breathing"],
    ["I have chest pain since this morning", "urgent.chest_pain"],
    ["I'm soaking a pad every hour", "urgent.heavy_bleeding"],
    ["I fainted after my shot", "urgent.fainting"],
    ["belly is swollen and I've been vomiting", "urgent.ohss_bloat_vomit"],
    ["Estoy hinchada y casi no orino", "urgent.ohss_bloat_low_urine"],
    ["my calf pain is getting worse and my leg is swollen", "urgent.clot_leg"],
    ["I have a fever of 101", "urgent.fever"],
  ];
  it.each(urgent)("flags %s", (msg, rule) => {
    const t = triage(msg);
    expect(t.level).toBe("urgent");
    expect(t.routeTo).toBe("on_call_nurse");
    expect(t.ruleIds).toContain(rule);
  });

  it("sends self-harm to crisis resources, ahead of everything else", () => {
    const t = triage("I can't breathe and I want to end my life");
    expect(t.level).toBe("crisis");
    expect(t.routeTo).toBe("crisis_resources");
  });

  it("over-triggers on negation on purpose", () => {
    expect(triage("no chest pain, just curious").level).toBe("urgent");
  });

  it("leaves ordinary questions alone", () => {
    for (const msg of ["When is my next ultrasound?", "I missed my 8pm Gonal-f dose", "a little bloated today", "¿Puedo tomar café?"]) {
      expect(triage(msg).level).toBe("routine");
    }
  });
});

describe("results are labelled in code, against the clinic's ranges", () => {
  const ranges: ClinicRange[] = [{
    analyte: "estradiol", unit: "pg/mL", dayFrom: 5, dayTo: 7, low: 300, high: 900,
    inRangeText: { en: "Right where Bayside expects for day 6.", es: "Justo donde Bayside espera para el día 6." },
    approvedBy: "Maria Lopez, RN",
  }];

  it("shows the nurse-approved text when in range", () => {
    const r = labelResult({ analyte: "estradiol", unit: "pg/mL", value: 612, stimDay: 6 }, ranges);
    expect(r.status).toBe("in_range");
    expect(r.routeToNurse).toBe(false);
    expect(r.explanation).toContain("Bayside");
    expect(r.approvedBy).toBe("Maria Lopez, RN");
  });

  it.each([
    [{ value: 120, unit: "pg/mL", stimDay: 6 }, "below_range"],
    [{ value: 1400, unit: "pg/mL", stimDay: 6 }, "above_range"],
    [{ value: 612, unit: "pmol/L", stimDay: 6 }, "unit_mismatch"],
    [{ value: 612, unit: "pg/mL", stimDay: 11 }, "no_range"],
    [{ value: Number.NaN, unit: "pg/mL", stimDay: 6 }, "no_range"],
  ] as const)("never explains %o and routes it to the nurse", (partial, status) => {
    const r = labelResult({ analyte: "estradiol", ...partial }, ranges, "es");
    expect(r.status).toBe(status);
    expect(r.routeToNurse).toBe(true);
    expect(r.explanation).toBeUndefined();
    expect(r.patientText).toBe("Tu enfermera lo revisará contigo.");
  });
});

describe("partner and staff permissions", () => {
  const subject = { patientId: "p1", patientUserId: "u-maya", clinicId: "bayside" };
  const grant: PartnerGrant = { patientId: "p1", partnerUserId: "u-jordan", sections: ["schedule", "meds"], revokedAt: null };
  const jordan = { userId: "u-jordan", clinicId: "bayside", role: "partner" as const };

  it("lets a partner see only shared sections", () => {
    expect(canView(jordan, subject, "meds", [grant])).toBe(true);
    expect(canView(jordan, subject, "results", [grant])).toBe(false);
    expect(canView(jordan, subject, "money", [grant])).toBe(false);
  });
  it("never shows patient-nurse messages to a partner", () => {
    expect(canView(jordan, subject, "messages", [{ ...grant, sections: ["messages"] }])).toBe(false);
  });
  it("cuts access the moment a grant is revoked", () => {
    expect(canView(jordan, subject, "meds", [{ ...grant, revokedAt: new Date() }])).toBe(false);
  });
  it("walls clinics off from each other", () => {
    expect(canView({ userId: "n2", clinicId: "other", role: "nurse" }, subject, "results")).toBe(false);
  });
  it("keeps clinical sections from roles that don't need them", () => {
    expect(canView({ userId: "s1", clinicId: "bayside", role: "financial_counselor" }, subject, "results")).toBe(false);
    expect(canView({ userId: "s1", clinicId: "bayside", role: "financial_counselor" }, subject, "money")).toBe(true);
    expect(canView({ userId: "a1", clinicId: "bayside", role: "clinic_admin" }, subject, "results")).toBe(false);
  });
});

describe("the missed-dose loop", () => {
  const base = (): Handoff => {
    const c = classifyMessage("I missed my 8pm Gonal-f dose", { reportedMissedDose: true });
    return {
      id: "h1", patientId: "p1", kind: c.kind, status: "open", patientMessage: "I missed my 8pm Gonal-f dose", triage: c.triage,
      attachedDoseLog: [{ medication: "Gonal-f", dose: "225 IU", scheduledFor: "2026-10-25T20:00:00-04:00", takenAt: null }],
      draft: null, draftSource: null, sentText: null, sentBy: null,
    };
  };
  const protocol = { id: "meds.missed_dose.gonal_f", title: "Missed Gonal-f", body: { en: "Take it as soon as you see this if it's within 4 hours. Otherwise skip it and tell us.", es: "Tómala en cuanto veas esto si han pasado menos de 4 horas. Si no, sáltala y avísanos." } };

  it("drafts from the clinic's protocol and needs a nurse to send", () => {
    const h = base();
    expect(h.kind).toBe("missed_dose");
    const d = draftFromProtocol(h, protocol, "en", "Maya");
    expect(d.source).toBe("meds.missed_dose.gonal_f");
    const drafted = { ...h, status: "drafted" as const, draft: d.draft, draftSource: d.source };
    expect(() => approveAndSend(drafted, { userId: "x", name: "Front desk", role: "scheduler" }, d.draft, "en")).toThrow(HandoffError);
    const sent = approveAndSend(drafted, { userId: "u-maria", name: "Maria", role: "nurse" }, d.draft, "en");
    expect(sent.status).toBe("sent");
    expect(sent.sentText).toContain("Drafted with The Pumpkin, reviewed by Maria.");
    expect(markRead(sent).status).toBe("read");
  });

  it("refuses to draft anything for urgent or crisis messages", () => {
    const c = classifyMessage("bloated and can't breathe", { reportedMissedDose: true });
    expect(c.kind).toBe("urgent_symptom");
    expect(() => draftFromProtocol({ ...base(), kind: c.kind, triage: c.triage }, protocol, "en", "Maya")).toThrow(HandoffError);
  });

  it("can't send twice", () => {
    const sent = approveAndSend(base(), { userId: "u-maria", name: "Maria", role: "nurse" }, "Call me back please.", "en");
    expect(() => approveAndSend(sent, { userId: "u-maria", name: "Maria", role: "nurse" }, "again", "en")).toThrow(HandoffError);
  });
});

/**
 * Results against the clinic's own ranges. Labels are computed in code, never by AI.
 *
 * - In range: the patient sees the clinic's fixed, nurse-approved explanation. Nothing generated.
 * - Out of range, no matching range, or a unit mismatch: the patient sees the number and
 *   "your nurse will review this with you", and the result is routed to the nurse queue.
 *   No explanation of any kind is shown.
 */

export type Lang = "en" | "es";

export interface ClinicRange {
  analyte: string; // e.g. "estradiol"
  unit: string; // e.g. "pg/mL"
  /** Stimulation day window this range applies to, inclusive. */
  dayFrom: number;
  dayTo: number;
  low: number;
  high: number;
  /** Fixed explanation shown only when the result is in range. Approved by a named nurse. */
  inRangeText: Record<Lang, string>;
  approvedBy: string;
}

export interface LabResult {
  analyte: string;
  unit: string;
  value: number;
  stimDay: number;
}

export type RangeStatus = "in_range" | "below_range" | "above_range" | "no_range" | "unit_mismatch";

export interface LabelledResult {
  status: RangeStatus;
  /** Present only when status is in_range. */
  explanation?: string;
  approvedBy?: string;
  /** True for anything that is not in range. The caller must create a nurse task. */
  routeToNurse: boolean;
  patientText: string;
}

const NURSE_REVIEW: Record<Lang, string> = {
  en: "Your nurse will review this with you.",
  es: "Tu enfermera lo revisará contigo.",
};

export function labelResult(result: LabResult, ranges: ClinicRange[], lang: Lang = "en"): LabelledResult {
  const sameAnalyte = ranges.filter(
    (r) => r.analyte === result.analyte && result.stimDay >= r.dayFrom && result.stimDay <= r.dayTo,
  );
  if (sameAnalyte.length === 0) {
    return { status: "no_range", routeToNurse: true, patientText: NURSE_REVIEW[lang] };
  }
  const range = sameAnalyte.find((r) => r.unit === result.unit);
  if (!range) {
    return { status: "unit_mismatch", routeToNurse: true, patientText: NURSE_REVIEW[lang] };
  }
  if (!Number.isFinite(result.value)) {
    return { status: "no_range", routeToNurse: true, patientText: NURSE_REVIEW[lang] };
  }
  if (result.value < range.low) {
    return { status: "below_range", routeToNurse: true, patientText: NURSE_REVIEW[lang] };
  }
  if (result.value > range.high) {
    return { status: "above_range", routeToNurse: true, patientText: NURSE_REVIEW[lang] };
  }
  return {
    status: "in_range",
    explanation: range.inRangeText[lang],
    approvedBy: range.approvedBy,
    routeToNurse: false,
    patientText: range.inRangeText[lang],
  };
}

/**
 * The closed loop: patient message -> safety check -> nurse queue with context -> drafted reply
 * -> a nurse approves and sends -> the patient reads it.
 *
 * The draft never reaches a patient on its own. Only a nurse or physician can send it,
 * and the sent message always carries a disclosure line naming who reviewed it.
 */

import type { Lang } from "./ranges";
import type { StaffRole } from "./permissions";
import { triage, type TriageResult } from "./triage";

export type HandoffKind = "missed_dose" | "question" | "urgent_symptom" | "result_review" | "crisis";
export type HandoffStatus = "open" | "drafted" | "sent" | "read" | "closed";

export interface DoseLogEntry {
  medication: string;
  dose: string;
  scheduledFor: string; // ISO time
  takenAt: string | null;
}

export interface Handoff {
  id: string;
  patientId: string;
  kind: HandoffKind;
  status: HandoffStatus;
  patientMessage: string;
  triage: TriageResult;
  /** Context attached so the nurse doesn't have to look anything up. */
  attachedDoseLog: DoseLogEntry[];
  draft: string | null;
  draftSource: string | null; // which protocol section the draft came from
  sentText: string | null;
  sentBy: string | null;
}

export class HandoffError extends Error {}

const SENDERS: StaffRole[] = ["nurse", "physician"];

/** Classify an incoming patient message. Safety comes first: urgent and crisis outrank everything. */
export function classifyMessage(message: string, opts: { reportedMissedDose?: boolean } = {}): { kind: HandoffKind; triage: TriageResult } {
  const t = triage(message);
  if (t.level === "crisis") return { kind: "crisis", triage: t };
  if (t.level === "urgent") return { kind: "urgent_symptom", triage: t };
  if (opts.reportedMissedDose) return { kind: "missed_dose", triage: t };
  return { kind: "question", triage: t };
}

export interface ProtocolSection {
  id: string;
  title: string;
  /** Clinic-approved text a nurse wrote. Drafts quote it; they never invent clinical instructions. */
  body: Record<Lang, string>;
}

/**
 * Draft a reply from the clinic's own protocol. This version is template-based and deterministic.
 * A model-based drafter can replace it later behind the same signature, but it must still only
 * draw from approved protocol sections and still require a nurse to send.
 */
export function draftFromProtocol(handoff: Handoff, protocol: ProtocolSection | undefined, lang: Lang, patientFirstName: string): { draft: string; source: string | null } {
  if (handoff.kind === "urgent_symptom" || handoff.kind === "crisis") {
    throw new HandoffError("Urgent and crisis messages are never drafted. A person calls the patient.");
  }
  if (!protocol) {
    const fallback = lang === "es"
      ? `Hola ${patientFirstName}, recibí tu mensaje y te respondo en breve.`
      : `Hi ${patientFirstName}, I got your message and will get back to you shortly.`;
    return { draft: fallback, source: null };
  }
  const greeting = lang === "es" ? `Hola ${patientFirstName},` : `Hi ${patientFirstName},`;
  return { draft: `${greeting} ${protocol.body[lang]}`, source: protocol.id };
}

export function disclosureLine(lang: Lang, reviewerName: string): string {
  return lang === "es"
    ? `Redactado con Kinpath, revisado por ${reviewerName}.`
    : `Drafted with Kinpath, reviewed by ${reviewerName}.`;
}

export function approveAndSend(handoff: Handoff, sender: { userId: string; name: string; role: StaffRole }, finalText: string, lang: Lang): Handoff {
  if (!SENDERS.includes(sender.role)) {
    throw new HandoffError(`A ${sender.role} cannot send clinical replies.`);
  }
  if (handoff.status !== "open" && handoff.status !== "drafted") {
    throw new HandoffError(`Cannot send a handoff that is ${handoff.status}.`);
  }
  const text = finalText.trim();
  if (text.length === 0) throw new HandoffError("Reply is empty.");
  const sentText = handoff.draft !== null ? `${text}\n\n${disclosureLine(lang, sender.name)}` : text;
  return { ...handoff, status: "sent", sentText, sentBy: sender.userId };
}

export function markRead(handoff: Handoff): Handoff {
  if (handoff.status !== "sent") throw new HandoffError(`Cannot mark a ${handoff.status} handoff as read.`);
  return { ...handoff, status: "read" };
}

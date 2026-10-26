/**
 * Who can see what. The database enforces the same rules with row-level security;
 * this module is the single readable source both the app and the tests use.
 */

export type Section = "schedule" | "results" | "meds" | "money" | "record" | "messages";
export const SECTIONS: Section[] = ["schedule", "results", "meds", "money", "record", "messages"];

export type StaffRole = "nurse" | "physician" | "financial_counselor" | "scheduler" | "clinic_admin";
export type Role = StaffRole | "patient" | "partner";

/** Staff access by role. Clinic admins manage users and settings but do not read clinical sections. */
export const STAFF_SECTIONS: Record<StaffRole, Section[]> = {
  nurse: ["schedule", "results", "meds", "record", "messages"],
  physician: ["schedule", "results", "meds", "record", "messages"],
  financial_counselor: ["schedule", "money"],
  scheduler: ["schedule"],
  clinic_admin: [],
};

export interface PartnerGrant {
  patientId: string;
  partnerUserId: string;
  sections: Section[];
  revokedAt: Date | null;
}

export interface Viewer {
  userId: string;
  clinicId: string;
  role: Role;
}

export interface Subject {
  patientId: string;
  patientUserId: string;
  clinicId: string;
}

export function canView(viewer: Viewer, subject: Subject, section: Section, grants: PartnerGrant[] = []): boolean {
  // Hard wall between clinics, before anything else.
  if (viewer.clinicId !== subject.clinicId) return false;

  switch (viewer.role) {
    case "patient":
      return viewer.userId === subject.patientUserId;
    case "partner": {
      // Messages stay private to the patient and her care team, even with a grant.
      if (section === "messages") return false;
      return grants.some(
        (g) =>
          g.patientId === subject.patientId &&
          g.partnerUserId === viewer.userId &&
          g.revokedAt === null &&
          g.sections.includes(section),
      );
    }
    default:
      return STAFF_SECTIONS[viewer.role].includes(section);
  }
}

/** Default partner grant when a patient invites someone: schedule and meds only. Results and money are opt-in. */
export const DEFAULT_PARTNER_SECTIONS: Section[] = ["schedule", "meds"];

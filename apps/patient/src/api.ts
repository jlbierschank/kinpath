/**
 * Talks to the Kinpath server (apps/clinic). Every call is checked on the server with
 * row-level security, so the app never sees more than the signed-in patient may.
 *
 * DEV ONLY: the "Dev <user id>" header picks a synthetic seed patient or partner. Real sign-in replaces it.
 */
import type { Lang, PlannedReminder, ReminderPrefs } from "@kinpath/core";

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

export interface Dose { id: string; medication: string; dose: string; scheduledFor: string; takenAt: string | null; reportedMissed: boolean }
export interface InboxItem { id: string; kind: string; status: string; patientMessage: string; sentText: string | null; sender: string | null }
export interface Today {
  clinic: { name: string; replyWindow: Record<Lang, string> };
  firstName: string | null; lang: Lang; stage: string | null; stimDay: number | null;
  schedule: { upcoming: Dose[]; missed: Dose[]; recent: Dose[] };
  inbox: InboxItem[];
  results: { id: string; analyte: string; value: number; unit: string; status: string; text: string; approvedBy: string | null }[];
  prefs: ReminderPrefs;
  reminders: PlannedReminder[];
  sharing: { partners: SupportPerson[]; notes: Note[]; invites: Invite[] };
}
export type Shareable = "schedule" | "meds" | "results";
export type Relationship = "partner" | "family" | "friend" | "other";
export interface SupportPerson { userId: string; name: string; relationship: Relationship; sections: Shareable[] }
export interface Invite { id: string; name: string; relationship: Relationship; contact: string; sections: Shareable[]; expiresAt: string }
export interface Note { id: string; fromName: string; body: string; level: "routine" | "urgent" | "crisis"; createdAt: string; seenAt: string | null }
export type PartnerHome =
  | { clinic: { name: string }; shared: false; name: string }
  | {
      clinic: { name: string }; shared: true; name: string; firstName: string | null; sections: Shareable[];
      stage: string | null; stimDay: number | null;
      schedule: { upcoming: Dose[]; missed: Dose[]; recent: Dose[] } | null;
      results: { id: string; analyte: string; value: number; unit: string; status: string; text: string }[] | null;
      notes: Note[];
    };
export interface Guide { medication: string; steps: Record<Lang, string>[]; videoUrl: string | null; approvedBy: string }
export interface SendResult { handoffId: string; kind: "missed_dose" | "question" | "urgent_symptom" | "crisis" | "result_review" }

export class Api {
  constructor(private userId: string) {}
  private async call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const res = await fetch(`${API_URL}${path}`, {
      method: init?.method ?? "GET",
      headers: { Authorization: `Dev ${this.userId}`, "Content-Type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
    return data;
  }
  today = () => this.call<Today>("/api/patient/today");
  guide = (medication: string) => this.call<Guide>(`/api/patient/guides/${encodeURIComponent(medication)}`);
  logDose = (id: string) => this.call<{ ok: boolean }>(`/api/patient/doses/${id}/log`, { method: "POST", body: {} });
  reportMissed = (id: string, note: string) => this.call<SendResult>(`/api/patient/doses/${id}/missed`, { method: "POST", body: { note } });
  sendMessage = (text: string) => this.call<SendResult>("/api/patient/messages", { method: "POST", body: { text } });
  markRead = (id: string) => this.call<{ ok: boolean }>(`/api/patient/messages/${id}/read`, { method: "POST", body: {} });
  setLockScreenDetail = (on: boolean) => this.call<{ ok: boolean }>("/api/patient/prefs", { method: "POST", body: { lockScreenDetail: on } });
  setSharing = (partnerUserId: string, sections: Shareable[]) => this.call<{ sections: Shareable[] }>("/api/patient/sharing", { method: "POST", body: { partnerUserId, sections } });
  createInvite = (input: { name: string; relationship: Relationship; contact: string; sections: Shareable[] }) =>
    this.call<{ id: string; code: string; expiresAt: string }>("/api/patient/invites", { method: "POST", body: input });
  cancelInvite = (id: string) => this.call<{ ok: boolean }>(`/api/patient/invites/${id}/cancel`, { method: "POST", body: {} });
  removePerson = (partnerUserId: string) => this.call<{ ok: boolean }>("/api/patient/sharing/remove", { method: "POST", body: { partnerUserId } });
  noteSeen = (id: string) => this.call<{ ok: boolean }>(`/api/patient/notes/${id}/seen`, { method: "POST", body: {} });
  // Partner side
  partnerHome = () => this.call<PartnerHome>("/api/partner/home");
  sendNote = (text: string) => this.call<{ id: string; level: "routine" | "urgent" | "crisis" }>("/api/partner/notes", { method: "POST", body: { text } });
}

/** The invited person enters their code. No account exists yet, so no Authorization header. */
export async function acceptInvite(code: string, name: string): Promise<{ userId: string; name: string; patientFirstName: string }> {
  const res = await fetch(`${API_URL}/api/invites/accept`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, name }) });
  const data = (await res.json().catch(() => ({}))) as { error?: string; userId: string; name: string; patientFirstName: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

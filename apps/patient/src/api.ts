/**
 * Talks to the Kinpath server (apps/clinic). Every call is checked on the server with
 * row-level security, so the app never sees more than the signed-in patient may.
 *
 * Signed in with a session token from a one-time code ("Bearer"). Demo builds can also use
 * "Dev <user id>" to pick a synthetic test person; the server refuses that outside demo builds.
 */
import type { Lang, PlannedReminder, ReminderPrefs } from "@kinpath/core";

// "same-origin" is used when the phone app is published as web pages on the clinic server (/phone).
const RAW_API_URL = process.env.EXPO_PUBLIC_API_URL;
export const API_URL = RAW_API_URL === "same-origin" ? "" : (RAW_API_URL ?? "http://localhost:3000");

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
  wait: Wait;
  appointments?: Appointment[];
}
export interface Money {
  estimates: { id: string; title: string; note: string | null; validUntil: string | null; items: { id: string; label: string; category: string; amountCents: number; insuranceCents: number }[]; totalCents: number; insuranceCents: number; youPayCents: number }[];
  coverage: { id: string; payerName: string | null; planName: string | null; memberLast4: string | null; fertilityBenefit: string | null; lifetimeMaxCents: number | null; lifetimeUsedCents: number;
    cyclesMax: number | null; cyclesUsed: number; deductibleCents: number | null; deductibleMetCents: number; oopMaxCents: number | null; oopMetCents: number; priorAuth: string; active: boolean }[];
  ledger: { id: string; kind: "charge" | "payment" | "adjustment" | "refund"; description: string; amountCents: number; occurredOn: string; dueOn: string | null; receiptNumber: string | null }[];
  balanceCents: number; paidCents: number; nextDue: { dueOn: string; amountCents: number } | null;
  questions: { id: string; question: string; answer: string | null; answeredBy: string | null; createdAt: string; read: boolean }[];
  partners: { id: string; kind: string; name: string; description: string; url: string | null; phone: string | null }[];
}
export interface Receipt { receiptNumber: string; date: string; description: string; amountCents: number; method: string | null; patientName: string; clinicName: string }
export interface Appointment { id: string; startsAt: string; kind: string; title: string; location: string | null; status: string; source: string }
export type Shareable = "schedule" | "meds" | "results" | "money";
export type ResultHow = "call" | "app" | "together";
export type Feeling = "okay" | "anxious" | "struggling";
export interface Wait {
  stage: string | null; dayOfWait: number | null; testAt: string | null;
  prefs: { resultHow: ResultHow | null; hideDayCount: boolean; quietOff: boolean; toldSupport: boolean };
  checkedInToday: Feeling | null;
  result: null | { outcome: "positive" | "negative" | "repeat"; hcg: number | null; note: string; by: string; releasedAt: string };
  quietUntil: string | null;
  answers: { id: string; title: string; text: string }[];
}
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
      wait: { dayOfWait: number | null; testAt: string | null; resultIsIn: boolean } | null;
      news: "positive" | "negative" | "repeat" | "graduated" | null;
      appointments?: Appointment[];
    };
export type KeepsakeId = "start" | "injections" | "transfer" | "wait" | "positive" | "graduated";
export interface Graduation {
  graduatedOn: string | null; ob: string | null; days: number | null;
  keepsake: { saved: boolean; hidden: KeepsakeId[]; items: { id: KeepsakeId; date: string | null; injections: number | null; hcg: number | null }[] };
  shares: { id: string; recipient: string; includeResults: boolean; includeMeds: boolean; createdAt: string; expiresAt: string; active: boolean; views: number; lastViewedAt: string | null }[];
  toldSupport: boolean;
}
export interface NextCycle { embryosFrozen: number | null; options: { id: string; title: string; text: string }[]; questions: string; readyAt: string | null }
export type Channel = "in_app" | "push" | "sms" | "email";
export interface AppNotification { id: string; kind: string; title: string; link: string | null; urgent: boolean; at: string; read: boolean }
export interface NotificationSettings {
  audience: "patient" | "partner" | "staff";
  kinds: { kind: string; label: { en: string; es: string }; description: { en: string; es: string }; urgent: boolean; channels: Record<Channel, boolean> }[];
  quiet: { on: boolean; start: string; end: string };
  phone: string | null;
}
export interface Guide { medication: string; steps: Record<Lang, string>[]; videoUrl: string | null; approvedBy: string }
export interface SendResult { handoffId: string; kind: "missed_dose" | "question" | "urgent_symptom" | "crisis" | "result_review" }

export type Auth = { token: string } | { devUserId: string };
export class SignedOutError extends Error {}

export class Api {
  constructor(private auth: Auth, private onSignedOut?: () => void) {}
  private async call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const res = await fetch(`${API_URL}${path}`, {
      method: init?.method ?? "GET",
      headers: { Authorization: "token" in this.auth ? `Bearer ${this.auth.token}` : `Dev ${this.auth.devUserId}`, "Content-Type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (res.status === 401) { this.onSignedOut?.(); throw new SignedOutError(data.error ?? "Please sign in again."); }
    if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
    return data;
  }
  // Account
  notifications = () => this.call<{ unread: number; items: AppNotification[] }>("/api/me/notifications");
  markNotificationsRead = (ids: string[] | "all") => this.call<{ ok: boolean }>("/api/me/notifications", { method: "POST", body: { ids } });
  notificationSettings = () => this.call<NotificationSettings>("/api/me/notification-settings");
  saveNotificationSettings = (change: { kind?: string; channels?: Partial<Record<Channel, boolean>>; quiet?: { on: boolean; start: string; end: string }; phone?: string | null }) =>
    this.call<NotificationSettings>("/api/me/notification-settings", { method: "POST", body: change });
  sessions = () => this.call<{ id: string; device: string; createdAt: string; lastSeenAt: string; current: boolean }[]>("/api/me/sessions");
  signOutOthers = () => this.call<{ signedOut: number }>("/api/auth/signout-others", { method: "POST", body: {} });
  signOut = () => this.call<{ ok: boolean }>("/api/auth/signout", { method: "POST", body: {} }).catch(() => ({ ok: false }));
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
  setWaitPrefs = (change: { resultHow?: ResultHow; hideDayCount?: boolean; quietOff?: boolean }) => this.call<{ ok: boolean }>("/api/patient/wait/prefs", { method: "POST", body: change });
  checkIn = (feeling: Feeling) => this.call<{ nurseWillCall: boolean }>("/api/patient/wait/checkin", { method: "POST", body: { feeling } });
  askForCall = (why: "rough_day" | "counselor") => this.call<{ ok: boolean }>("/api/patient/wait/call", { method: "POST", body: { why } });
  graduation = () => this.call<Graduation>("/api/patient/graduation");
  saveKeepsake = (hidden: KeepsakeId[]) => this.call<{ ok: boolean }>("/api/patient/graduation/keepsake", { method: "POST", body: { hidden } });
  createSummaryShare = (input: { recipient: string; includeResults: boolean; includeMeds: boolean }) =>
    this.call<{ id: string; url: string; expiresAt: string }>("/api/patient/summary-shares", { method: "POST", body: input });
  stopSummaryShare = (id: string) => this.call<{ ok: boolean }>(`/api/patient/summary-shares/${id}/stop`, { method: "POST", body: {} });
  shareNews = () => this.call<{ ok: boolean }>("/api/patient/share-news", { method: "POST", body: {} });
  sendThanks = (text: string) => this.call<{ sent: "thanks" } | { sent: "urgent"; kind: SendResult["kind"]; handoffId: string }>("/api/patient/thanks", { method: "POST", body: { text } });
  nextCycle = () => this.call<NextCycle>("/api/patient/next-cycle");
  saveNextCycle = (change: { questions?: string; ready?: boolean }) => this.call<{ newlyReady: boolean }>("/api/patient/next-cycle", { method: "POST", body: change });
  noteSeen = (id: string) => this.call<{ ok: boolean }>(`/api/patient/notes/${id}/seen`, { method: "POST", body: {} });
  // Partner side
  partnerHome = () => this.call<PartnerHome>("/api/partner/home");
  money = () => this.call<Money>("/api/patient/money");
  partnerMoney = () => this.call<Money>("/api/partner/money");
  askCost = (question: string, estimateId?: string) => this.call<{ ok: boolean }>("/api/patient/money/questions", { method: "POST", body: { question, estimateId } });
  markCostRead = () => this.call<{ ok: boolean }>("/api/patient/money/read", { method: "POST", body: {} });
  receipt = (id: string) => this.call<Receipt>(`/api/patient/money/receipt/${id}`);
  sendNote = (text: string) => this.call<{ id: string; level: "routine" | "urgent" | "crisis" }>("/api/partner/notes", { method: "POST", body: { text } });
}

async function openCall<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}
export interface SignedInUser { token: string; userId: string; name: string; role: "patient" | "partner" }
/** Sign-in, before there's a session. */
export const auth = {
  requestCode: (identifier: string) => openCall<{ sentTo: string }>("/api/auth/code", { identifier }),
  verifyCode: (identifier: string, code: string, device: string) => openCall<SignedInUser>("/api/auth/verify", { identifier, code, device }),
  startJoin: (code: string, name: string) => openCall<{ sentTo: string; patientFirstName: string }>("/api/auth/join/start", { code, name }),
  finishJoin: (code: string, confirm: string, device: string) => openCall<SignedInUser & { patientFirstName: string }>("/api/auth/join/finish", { code, confirm, device }),
};

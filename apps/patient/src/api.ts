/**
 * Talks to the Kinpath server (apps/clinic). Every call is checked on the server with
 * row-level security, so the app never sees more than the signed-in patient may.
 *
 * Signed in with a session token from a one-time code ("Bearer"). Demo builds can also use
 * "Dev <user id>" to pick a synthetic test person; the server refuses that outside demo builds.
 */
import type { Lang, PlannedReminder, ReminderPrefs, StageKit } from "@kinpath/core";

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
  | { clinic: { name: string; personal?: boolean }; shared: false; name: string }
  | {
      clinic: { name: string; personal?: boolean }; shared: true; name: string; firstName: string | null; sections: Shareable[];
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

// ---------- Pumpkin on your own ----------
export type SoloStage = "trying" | "just_starting" | "freezing_eggs" | "in_cycle" | "two_week_wait" | "pregnant" | "after_hard_result" | "between_cycles" | "storage";
export interface SoloProfile { aiReads: { on: boolean; plan: "free" | "premium"; used: number; limit: number | null; left: number | null }; firstName: string; stage: SoloStage; stageLabel: string; clinicName: string | null; afterHoursPhone: string | null; askedClinicAt: string | null; calendarOn: boolean; calendarDetail: boolean; forwardAddress: string; timeZone: string }
export interface About {
  firstName: string; displayName: string; preferredName: string | null; pronunciation: string | null; pronouns: string | null; consented: boolean;
  gender: string | null; familyPath: string[]; partnerName: string | null; partnerPronouns: string | null; partnerTitle: string | null;
  conditions: string[]; conditionsOther: string | null; pastCycles: number | null; pastLoss: "yes" | "no" | "skip" | null; allergies: string | null;
  tone: "facts" | "reassure"; revealResults: boolean; costCheckins: "always" | "when_due"; pauseUntil: string | null; onBreak: boolean;
  alias: string | null; aliasIcon: string | null; aliasTint: string | null; aliasShows: ("stage" | "path")[];
  stepsLeft: ("name" | "path" | "person" | "background" | "talk")[];
  tenderDates: { id: string; month: number; day: number; year: number | null; label: string | null; mode: "quiet" | "gentle" }[];
}
export interface VisitSummary { name: string; pronouns: string | null; path: string[]; person: string | null; background: string[]; pastCycles: number | null; pastLoss: boolean; allergies: string | null; meds: string[]; results: string[]; questions: string[] }
export interface SoloToday {
  feel: { tender: { mode: "quiet" | "gentle"; label: string | null } | null; paused: boolean; pauseUntil: string | null; onBreak: boolean; quiet: boolean };
  about: { displayName: string; pronouns: string | null; tone: "facts" | "reassure"; revealResults: boolean; costCheckins: "always" | "when_due"; stepsLeft: About["stepsLeft"]; partnerTitle: string | null };
  profile: SoloProfile;
  schedule: { upcoming: Dose[]; missed: Dose[]; recent: Dose[] };
  toCheck: number; reading: number;
  appointments: { id: string; startsAt: string; title: string; location: string | null; mine: boolean }[];
  latestResults: { key: string; name: string; value: number; unit: string; on: string }[];
  nextDue: { dueOn: string; amountCents: number; description: string } | null; balanceCents: number;
  openQuestions: number;
  refills: Refill[];
  kit: StageKit;
  reminders: PlannedReminder[]; prefs: ReminderPrefs;
}
export interface PersonalShare { id: string; recipient: string; includeResults: boolean; includeMeds: boolean; createdAt: string; expiresAt: string; active: boolean; views: number }
export interface Refill { medication: string; dosesLeft: number | null; perDay: number; enough: boolean; runOutOn: string | null; orderBy: string | null; daysLeft: number | null; countedAt: string | null }
export interface SoloMed { id: string; medication: string; dose: string; time: string; startsOn: string; endsOn: string | null; instructions: string | null; mine: boolean; nextAt: string | null }
export interface ResultGroup { key: string; name: string; unit: string; measures: string | null; inTreatment: string | null; reviewed: boolean; points: { id: string; value: number; unit: string; on: string; refLow: number | null; refHigh: number | null; refText: string | null; mine: boolean }[] }
export interface SoloCosts { entries: { id: string; kind: "charge" | "payment" | "adjustment" | "refund"; description: string; amountCents: number; occurredOn: string; dueOn: string | null; method: string | null; captureId: string | null; mine: boolean }[]; balanceCents: number; paidCents: number; paidThisYearCents: number; year: string; nextDue: { dueOn: string; amountCents: number; description: string } | null }
export type ItemKind = "medication" | "result" | "appointment" | "cost" | "question";
export interface PendingItem { id: string; captureId: string; kind: ItemKind; data: Record<string, unknown>; unsure: string[]; source: { kind: string; filename: string | null; at: string; hasFile: boolean; engine: string | null } }
export interface CaptureResult { captureId: string; status: "ready" | "failed" | "urgent"; urgent: "urgent" | "crisis" | null; items: number; problem: string | null; engine: string; readsLeft: number | null }
export interface CaptureInput { kind: "photo" | "pdf" | "text" | "voice" | "sample"; mime?: string; filename?: string; base64?: string; text?: string; sampleId?: string }

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
  setSupply = (medication: string, doses: number | null) => this.call<Refill[]>("/api/solo/supply", { method: "POST", body: { medication, doses } });
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
  // On your own
  me = () => this.call<{ name: string; role: "patient" | "partner"; space: "personal" | "clinic" }>("/api/me");
  soloToday = () => this.call<SoloToday>("/api/solo/today");
  soloProfile = () => this.call<SoloProfile>("/api/solo/profile");
  saveSoloProfile = (change: { stage?: SoloStage; clinicName?: string; afterHoursPhone?: string }) => this.call<unknown>("/api/solo/profile", { method: "POST", body: change });
  askMyClinic = (clinicName: string) => this.call<{ ok: boolean; shareText: string }>("/api/solo/ask-clinic", { method: "POST", body: { clinicName } });
  soloSharing = () => this.call<{ partners: SupportPerson[]; notes: Note[]; invites: Invite[] }>("/api/solo/sharing");
  sendFeedback = (body: string, screen?: string, appVersion?: string) => this.call<{ ok: boolean }>("/api/feedback", { method: "POST", body: { body, screen, appVersion } });
  soloMeds = () => this.call<SoloMed[]>("/api/solo/meds");
  saveKit = (patch: Record<string, unknown>) => this.call<{ kit: StageKit; urgent: "urgent" | "crisis" | null }>("/api/solo/kit", { method: "POST", body: { patch } });
  setMedLastDay = (medication: string, lastDay: string) => this.call<{ lastDay: string }>("/api/solo/med-last-day", { method: "POST", body: { medication, lastDay } });
  personalShares = () => this.call<PersonalShare[]>("/api/solo/shares");
  sharePersonalSummary = (input: { recipient: string; includeResults: boolean; includeMeds: boolean }) => this.call<{ id: string; url: string; expiresAt: string }>("/api/solo/share-summary", { method: "POST", body: input });
  stopPersonalShare = (id: string) => this.call<unknown>("/api/solo/stop-share", { method: "POST", body: { id } });
  soloResults = () => this.call<ResultGroup[]>("/api/solo/results");
  soloCosts = () => this.call<SoloCosts>("/api/solo/costs");
  questions = () => this.call<{ id: string; question: string; asked: boolean }[]>("/api/solo/questions");
  itemsToCheck = () => this.call<PendingItem[]>("/api/solo/items");
  samples = () => this.call<{ id: string; label: string; description: string }[]>("/api/solo/samples");
  captureOriginal = (id: string) => this.call<{ mime: string; filename: string; base64: string }>(`/api/solo/file?id=${encodeURIComponent(id)}`);
  capture = (input: CaptureInput) => this.call<CaptureResult>("/api/solo/capture", { method: "POST", body: input });
  saveItem = (id: string, data: Record<string, unknown> | null, checked = false) => this.call<{ savedId: string }>("/api/solo/save-item", { method: "POST", body: { id, data, checked } });
  dismissItem = (id: string) => this.call<unknown>("/api/solo/dismiss-item", { method: "POST", body: { id } });
  addByHand = (kind: ItemKind, data: Record<string, unknown>) => this.call<{ id: string }>(`/api/solo/${{ medication: "add-med", result: "add-result", appointment: "add-appointment", cost: "add-cost", question: "add-question" }[kind]}`, { method: "POST", body: kind === "question" ? { text: data.text } : { data } });
  removeMine = (kind: "stop-med" | "delete-result" | "delete-appointment" | "delete-cost" | "delete-question", id: string) => this.call<unknown>(`/api/solo/${kind}`, { method: "POST", body: { id } });
  setQuestionAsked = (id: string, asked: boolean) => this.call<unknown>("/api/solo/question-asked", { method: "POST", body: { id, asked } });
  calendarShares = () => this.call<{ id: string; label: string; detail: boolean; createdAt: string }[]>("/api/solo/calendar-shares");
  shareCalendar = (label: string, detail: boolean) => this.call<{ id: string; url: string; webcal: string }>("/api/solo/calendar-share", { method: "POST", body: { label, detail } });
  stopCalendarShare = (id: string) => this.call<unknown>("/api/solo/calendar-share-stop", { method: "POST", body: { id } });
  calendarLink = (detail: boolean) => this.call<{ url: string; webcal: string }>("/api/solo/calendar", { method: "POST", body: { detail } });
  calendarOff = () => this.call<unknown>("/api/solo/calendar-off", { method: "POST", body: {} });
  about = () => this.call<About>("/api/solo/about");
  saveAbout = (patch: Partial<About>, opts: { consent?: boolean; step?: string } = {}) => this.call<About>("/api/solo/about", { method: "POST", body: { patch, consent: opts.consent, step: opts.step } });
  withdrawAbout = () => this.call<About>("/api/solo/about-withdraw", { method: "POST", body: {} });
  addTenderDate = (date: { month: number; day: number; year: number | null; label: string; mode: "quiet" | "gentle" }) => this.call<About>("/api/solo/tender-add", { method: "POST", body: { date } });
  deleteTenderDate = (id: string) => this.call<About>("/api/solo/tender-delete", { method: "POST", body: { id } });
  setQuiet = (q: { pauseDays?: number | null; onBreak?: boolean }) => this.call<About>("/api/solo/quiet", { method: "POST", body: q });
  setAlias = (a: { alias: string; icon: string; tint: string; shows: string[] }) => this.call<About>("/api/solo/alias", { method: "POST", body: a });
  questionIdeas = () => this.call<string[]>("/api/solo/question-ideas");
  visitSummary = () => this.call<VisitSummary>("/api/solo/visit-summary");
  exportData = () => this.call<Record<string, unknown>>("/api/solo/export");
  deleteAccount = (confirm: string) => this.call<{ deleted: boolean }>("/api/solo/delete-account", { method: "POST", body: { confirm } });
  sendNote = (text: string) => this.call<{ id: string; level: "routine" | "urgent" | "crisis" }>("/api/partner/notes", { method: "POST", body: { text } });
}

async function openCall<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}
export interface SignedInUser { token: string; userId: string; name: string; role: "patient" | "partner"; space?: "personal" | "clinic" }
/** Sign-in, before there's a session. */
export const auth = {
  requestCode: (identifier: string) => openCall<{ sentTo: string }>("/api/auth/code", { identifier }),
  verifyCode: (identifier: string, code: string, device: string) => openCall<SignedInUser>("/api/auth/verify", { identifier, code, device }),
  startJoin: (code: string, name: string) => openCall<{ sentTo: string; patientFirstName: string }>("/api/auth/join/start", { code, name }),
  signupStart: (identifier: string) => openCall<{ sentTo: string }>("/api/auth/signup/start", { identifier }),
  signupVerify: (identifier: string, code: string) => openCall<{ ticket: string }>("/api/auth/signup/verify", { identifier, code }),
  signupFinish: (input: { ticket: string; firstName: string; preferredName?: string; pronouns?: string; stage: SoloStage; clinicName?: string; afterHoursPhone?: string; timeZone?: string; device: string }) => openCall<SignedInUser>("/api/auth/signup/finish", input),
  finishJoin: (code: string, confirm: string, device: string) => openCall<SignedInUser & { patientFirstName: string }>("/api/auth/join/finish", { code, confirm, device }),
};

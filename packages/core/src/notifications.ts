/**
 * Who gets which alert, and how. Pure rules, tested on their own.
 *
 * Privacy: anything that leaves the app (push, text, email) carries no health details, only
 * "You have a new update" style text. The specifics stay in the app, behind sign-in.
 * Safety: urgent safety alerts for nurses can't be switched off, only routed, and they ignore
 * quiet hours and summaries.
 */

export type Channel = "in_app" | "push" | "sms" | "email";
export const OUTSIDE: Exclude<Channel, "in_app">[] = ["push", "sms", "email"];
export type Audience = "staff" | "patient" | "partner";

export type NotificationKind =
  | "urgent_message" | "new_message" | "result_to_review" | "call_to_make" | "thank_you"
  | "nurse_reply" | "result_ready" | "support_note" | "support_joined" | "summary_opened"
  | "news_shared" | "access_changed";

export interface KindInfo {
  audience: Audience;
  label: { en: string; es: string };
  description: { en: string; es: string };
  /** Defaults for a new user. */
  defaults: Record<Channel, boolean>;
  /** Urgent: ignores quiet hours and summaries, and must reach the person outside the app. */
  urgent?: boolean;
}

const d = (in_app: boolean, push: boolean, sms: boolean, email: boolean): Record<Channel, boolean> => ({ in_app, push, sms, email });

export const KINDS: Record<NotificationKind, KindInfo> = {
  urgent_message: {
    audience: "staff", urgent: true, defaults: d(true, true, true, false),
    label: { en: "Urgent safety alerts", es: "Alertas urgentes de seguridad" },
    description: { en: "A patient reports an urgent symptom or crisis. Always on; choose how it reaches you.", es: "Una paciente reporta un síntoma urgente o una crisis. Siempre activas; elige cómo te llegan." },
  },
  new_message: {
    audience: "staff", defaults: d(true, true, false, false),
    label: { en: "New patient messages", es: "Mensajes nuevos de pacientes" },
    description: { en: "Questions and missed doses in the queue.", es: "Preguntas y dosis olvidadas en la lista." },
  },
  result_to_review: {
    audience: "staff", defaults: d(true, false, false, false),
    label: { en: "Results to review", es: "Resultados por revisar" },
    description: { en: "A result came back outside the clinic's range.", es: "Un resultado salió fuera del rango de la clínica." },
  },
  call_to_make: {
    audience: "staff", defaults: d(true, true, false, false),
    label: { en: "Calls to make", es: "Llamadas pendientes" },
    description: { en: "Check-in calls, follow-ups and patients ready for next steps.", es: "Llamadas de seguimiento y pacientes listas para los próximos pasos." },
  },
  thank_you: {
    audience: "staff", defaults: d(true, false, false, false),
    label: { en: "Thank-you notes", es: "Notas de agradecimiento" },
    description: { en: "When a patient thanks the team.", es: "Cuando una paciente agradece al equipo." },
  },
  nurse_reply: {
    audience: "patient", defaults: d(true, true, false, false),
    label: { en: "Replies from your care team", es: "Respuestas de tu equipo" },
    description: { en: "When your nurse answers a message.", es: "Cuando tu enfermera responde un mensaje." },
  },
  result_ready: {
    audience: "patient", defaults: d(true, true, false, false),
    label: { en: "Results", es: "Resultados" },
    description: { en: "When a result is ready to see in the app.", es: "Cuando un resultado está listo en la app." },
  },
  support_note: {
    audience: "patient", defaults: d(true, true, false, false),
    label: { en: "Notes from your support people", es: "Notas de tus personas de apoyo" },
    description: { en: "When someone you invited sends you a note.", es: "Cuando alguien que invitaste te envía una nota." },
  },
  support_joined: {
    audience: "patient", defaults: d(true, false, false, false),
    label: { en: "Someone joined", es: "Alguien se unió" },
    description: { en: "When someone accepts your invite.", es: "Cuando alguien acepta tu invitación." },
  },
  summary_opened: {
    audience: "patient", defaults: d(true, false, false, false),
    label: { en: "Your summary was opened", es: "Abrieron tu resumen" },
    description: { en: "When your OB-GYN opens the summary you shared.", es: "Cuando tu ginecólogo abre el resumen que compartiste." },
  },
  news_shared: {
    audience: "partner", defaults: d(true, true, false, false),
    label: { en: "News she shares", es: "Noticias que comparte" },
    description: { en: "When she shares news with you.", es: "Cuando comparte una noticia contigo." },
  },
  access_changed: {
    audience: "partner", defaults: d(true, false, false, false),
    label: { en: "What she shares with you", es: "Lo que comparte contigo" },
    description: { en: "When she changes what you can see.", es: "Cuando cambia lo que puedes ver." },
  },
};

export const kindsFor = (a: Audience) => (Object.keys(KINDS) as NotificationKind[]).filter((k) => KINDS[k].audience === a);
export const audienceOf = (role: string): Audience => (role === "patient" ? "patient" : role === "partner" ? "partner" : "staff");

export interface DeliveryPrefs {
  channels: Partial<Record<NotificationKind, Partial<Record<Channel, boolean>>>>;
  quiet: { on: boolean; start: string; end: string }; // "21:00" to "07:00"
  digest: "off" | "morning" | "evening";
}
export const DEFAULT_DELIVERY: DeliveryPrefs = { channels: {}, quiet: { on: false, start: "21:00", end: "07:00" }, digest: "off" };

/** Channels for this kind, after defaults and the "urgent can't be silenced" rule. */
export function channelsFor(kind: NotificationKind, prefs: DeliveryPrefs): Record<Channel, boolean> {
  const info = KINDS[kind];
  const c = { ...info.defaults, ...(prefs.channels[kind] ?? {}) };
  if (info.urgent) {
    c.in_app = true;
    // Must reach her outside the app: if every outside channel is off, fall back to text.
    if (!c.push && !c.sms && !c.email) c.sms = true;
  }
  return c;
}

/** Can this preference be saved? Returns a plain reason when not. */
export function checkChannelChange(kind: NotificationKind, next: Partial<Record<Channel, boolean>>): string | null {
  const info = KINDS[kind];
  if (!info) return "Unknown alert.";
  if (info.urgent) {
    const merged = { ...info.defaults, ...next };
    if (merged.in_app === false) return "Urgent safety alerts always show in the app.";
    if (!merged.push && !merged.sms && !merged.email) return "Urgent safety alerts need at least one way to reach you outside the app: push, text or email.";
  }
  return null;
}

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };
export function inQuiet(now: Date, q: DeliveryPrefs["quiet"]): boolean {
  if (!q.on) return false;
  const t = now.getHours() * 60 + now.getMinutes(), s = toMin(q.start), e = toMin(q.end);
  return s <= e ? t >= s && t < e : t >= s || t < e;
}
function quietEnds(now: Date, q: DeliveryPrefs["quiet"]): Date {
  const e = toMin(q.end);
  const out = new Date(now);
  out.setHours(Math.floor(e / 60), e % 60, 0, 0);
  if (out <= now) out.setDate(out.getDate() + 1);
  return out;
}
function nextDigest(now: Date, which: "morning" | "evening"): Date {
  const out = new Date(now);
  out.setHours(which === "morning" ? 8 : 17, 0, 0, 0);
  if (out <= now) out.setDate(out.getDate() + 1);
  return out;
}

export interface OutsideDelivery { channel: Exclude<Channel, "in_app">; status: "send" | "held" | "digest"; sendAfter: Date }

/** Decides, for one person and one alert, what to do on each outside channel. */
export function planDelivery(kind: NotificationKind, prefs: DeliveryPrefs, now: Date): { inApp: boolean; outside: OutsideDelivery[] } {
  const c = channelsFor(kind, prefs);
  const urgent = KINDS[kind].urgent === true;
  const outside: OutsideDelivery[] = [];
  for (const ch of OUTSIDE) {
    if (!c[ch]) continue;
    if (urgent) outside.push({ channel: ch, status: "send", sendAfter: now });
    else if (KINDS[kind].audience === "staff" && prefs.digest !== "off" && ch !== "push") outside.push({ channel: ch, status: "digest", sendAfter: nextDigest(now, prefs.digest) });
    else if (inQuiet(now, prefs.quiet)) outside.push({ channel: ch, status: "held", sendAfter: quietEnds(now, prefs.quiet) });
    else outside.push({ channel: ch, status: "send", sendAfter: now });
  }
  return { inApp: c.in_app, outside };
}

/** The only text that ever leaves the app. No names, no medications, no results. */
export function outsideText(kind: NotificationKind, clinicName: string, lang: "en" | "es"): { subject: string; body: string } {
  if (KINDS[kind].urgent) {
    return { subject: "The Pumpkin: urgent", body: "URGENT: a patient needs a call now. Open The Pumpkin to see who." };
  }
  if (KINDS[kind].audience === "staff") return { subject: "The Pumpkin", body: "You have a new update in The Pumpkin." };
  return lang === "es"
    ? { subject: clinicName, body: `Tienes una novedad de ${clinicName}. Ábrela en la app.` }
    : { subject: clinicName, body: `You have a new update from ${clinicName}. Open the app to see it.` };
}

/**
 * Connecting her own space to her clinic (when the clinic is on Pumpkin). She asks and chooses what
 * to share; a nurse confirms who she is; the clinic then sees only what she shares, live, until she
 * stops. All checks live in the database functions in migration 023; these are thin, typed wrappers.
 */
import { HandoffError } from "@kinpath/core";
import { asActor, type Actor, type Db } from "./client";
import { notify } from "./notify";

export type LinkShare = { about: boolean; background: boolean; meds: boolean; results: boolean; visits: boolean; questions: boolean };
export const SHARE_KEYS: (keyof LinkShare)[] = ["about", "background", "meds", "results", "visits", "questions"];
export interface ClinicLink {
  id: string; clinicId: string; clinicName: string; status: "requested" | "active" | "declined" | "stopped";
  share: LinkShare; requestedAt: string; decidedAt: string | null; decidedBy: string | null;
}
export interface LinkRequest { id: string; legalName: string; preferredName: string | null; contact: string | null; requestedAt: string; share: LinkShare; status: "requested" | "active"; chartId: string | null; chartName: string | null }
export interface LinkedSpace {
  linkId: string; legalName: string; contact: string | null; since: string; stage: string | null;
  about: { preferredName: string | null; pronunciation: string | null; pronouns: string | null; familyPath: string[] | null; partnerName: string | null; partnerPronouns: string | null; partnerTitle: string | null; tone: "facts" | "reassure"; revealResults: boolean } | null;
  background: { conditions: string[]; conditionsOther: string | null; pastCycles: number | null; pastLoss: string | null; allergies: string | null } | null;
  meds: { medication: string; dose: string; time: string; startsOn: string | null; endsOn: string | null }[] | null;
  results: { test: string; value: number; unit: string; on: string; refText: string | null; refLow: number | null; refHigh: number | null }[] | null;
  visits: { title: string; at: string; location: string | null }[] | null;
  questions: string[] | null;
}

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
const shareOf = (r: Record<string, unknown>): LinkShare => ({ about: !!r.share_about, background: !!r.share_background, meds: !!r.share_meds, results: !!r.share_results, visits: !!r.share_visits, questions: !!r.share_questions });
const cleanShare = (s: Partial<LinkShare>) => Object.fromEntries(SHARE_KEYS.filter((k) => typeof s[k] === "boolean").map((k) => [k, s[k]]));
const friendly = (e: unknown): never => {
  const m = (e as Error).message ?? "";
  if (/clinic_links_live/.test(m)) throw new HandoffError("You've already asked this clinic. You can change what's shared or stop in You.");
  if (/not a clinic on Pumpkin/.test(m)) throw new HandoffError("That clinic isn't on Pumpkin yet. You can ask them to join instead.");
  if (/chart already connected/.test(m)) throw new HandoffError("That patient is already connected to a Pumpkin space.");
  if (/already decided|link already ended|no active link/.test(m)) throw new HandoffError("This request has already been handled. Refresh to see the latest.");
  if (/only nurses and physicians/.test(m)) throw new HandoffError("Only nurses and physicians can do this.");
  throw e;
};

// ---------- her side ----------

export async function joinableClinics(db: Db, actor: Actor, query: string) {
  return asActor(db, actor, async (tx) => (await tx.query<{ id: string; name: string }>(`SELECT id, name FROM kp_joinable_clinics($1)`, [query.slice(0, 80)])).rows);
}

export async function myClinicLinks(db: Db, actor: Actor, patientId: string): Promise<ClinicLink[]> {
  return asActor(db, actor, async (tx) => {
    const r = await tx.query<Record<string, unknown> & { id: string; clinic_id: string; status: ClinicLink["status"]; requested_at: Date; decided_at: Date | null; decided_by_name: string | null; clinic_name: string }>(
      `SELECT l.*, kp_clinic_name(l.clinic_id) AS clinic_name FROM clinic_links l WHERE l.patient_id = $1 ORDER BY l.requested_at DESC LIMIT 10`, [patientId]);
    return r.rows.map((x) => ({ id: x.id, clinicId: x.clinic_id, clinicName: x.clinic_name, status: x.status, share: shareOf(x), requestedAt: iso(x.requested_at)!, decidedAt: iso(x.decided_at), decidedBy: x.decided_by_name }));
  });
}

export async function requestClinicLink(db: Db, actor: Actor & { name?: string }, clinicId: string, share: Partial<LinkShare>) {
  if (actor.role !== "patient") throw new HandoffError("Only the patient can connect her space.");
  if (!SHARE_KEYS.some((k) => share[k])) throw new HandoffError("Choose at least one thing to share.");
  const id = await asActor(db, actor, async (tx) => (await tx.query<{ id: string }>(`SELECT kp_link_request($1, $2) AS id`, [clinicId, JSON.stringify(cleanShare(share))])).rows[0]!.id).catch(friendly);
  await notify(db, { clinicId, kind: "connect_request", title: "A patient asked to connect her Pumpkin to your clinic.", link: "/nurse", to: { clinicians: true } });
  return { id };
}

export async function updateClinicLink(db: Db, actor: Actor, linkId: string, change: { share?: Partial<LinkShare>; stop?: boolean }) {
  await asActor(db, actor, async (tx) => { await tx.query(`SELECT kp_link_update($1, $2, $3)`, [linkId, JSON.stringify(cleanShare(change.share ?? {})), change.stop === true]); }).catch(friendly);
  return { ok: true };
}

// ---------- the clinic's side ----------

export async function linkRequests(db: Db, staff: Actor): Promise<LinkRequest[]> {
  if (!["nurse", "physician", "clinic_admin"].includes(staff.role)) return [];
  return asActor(db, staff, async (tx) => {
    const r = await tx.query<Record<string, unknown> & { id: string; legal_name: string; contact: string | null; requested_at: Date; status: "requested" | "active"; clinic_patient_id: string | null; chart_name: string | null }>(
      `SELECT l.*, (SELECT p.first_name || ' ' || p.last_name FROM patients p WHERE p.id = l.clinic_patient_id) AS chart_name
         FROM clinic_links l WHERE l.status IN ('requested','active') ORDER BY l.status DESC, l.requested_at`);
    return r.rows.map((x) => ({ id: x.id, legalName: x.legal_name, preferredName: null, contact: x.contact, requestedAt: iso(x.requested_at)!, share: shareOf(x), status: x.status, chartId: x.clinic_patient_id, chartName: x.chart_name }));
  });
}

export async function decideLink(db: Db, staff: Actor & { name: string }, linkId: string, accept: boolean, chartId: string | null) {
  await asActor(db, staff, async (tx) => { await tx.query(`SELECT kp_link_decide($1, $2, $3, $4)`, [linkId, accept, chartId, staff.name]); }).catch(friendly);
  return { ok: true };
}

export async function matchLink(db: Db, staff: Actor, linkId: string, chartId: string) {
  await asActor(db, staff, async (tx) => { await tx.query(`SELECT kp_link_match($1, $2)`, [linkId, chartId]); }).catch(friendly);
  return { ok: true };
}

/** Her shared space for a chart (null if she hasn't connected, or stopped). Every look is logged. */
export async function linkedSpaceForChart(db: Db, staff: Actor, chartId: string): Promise<LinkedSpace | null> {
  if (staff.role !== "nurse" && staff.role !== "physician") return null;
  return asActor(db, staff, async (tx) => {
    const l = (await tx.query<{ id: string }>(`SELECT id FROM clinic_links WHERE clinic_patient_id = $1 AND status = 'active'`, [chartId])).rows[0];
    if (!l) return null;
    const s = (await tx.query<{ s: LinkedSpace | null }>(`SELECT kp_link_snapshot($1) AS s`, [l.id])).rows[0]?.s ?? null;
    return s ? { ...s, results: s.results?.map((r) => ({ ...r, value: Number(r.value) })) ?? null } : null;
  });
}

/** Linked space by link id (for a request not yet matched to a chart). */
export async function linkedSpace(db: Db, staff: Actor, linkId: string): Promise<LinkedSpace | null> {
  if (staff.role !== "nurse" && staff.role !== "physician") return null;
  return asActor(db, staff, async (tx) => (await tx.query<{ s: LinkedSpace | null }>(`SELECT kp_link_snapshot($1) AS s`, [linkId])).rows[0]?.s ?? null);
}

/** Preferred names and pronouns for charts connected to a Pumpkin space that shares them (for lists and the queue). */
export async function linkedNames(db: Db, staff: Actor): Promise<Record<string, { preferredName: string | null; pronouns: string | null }>> {
  if (staff.role !== "nurse" && staff.role !== "physician") return {};
  return asActor(db, staff, async (tx) => {
    const r = await tx.query<{ chart: string; n: { preferredName: string | null; pronouns: string | null } | null }>(`SELECT clinic_patient_id AS chart, kp_link_names(id) AS n FROM clinic_links WHERE status = 'active' AND clinic_patient_id IS NOT NULL`);
    return Object.fromEntries(r.rows.filter((x) => x.n).map((x) => [x.chart, x.n!]));
  });
}

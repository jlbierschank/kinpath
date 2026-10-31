/**
 * Her choices about her data. Both are off until she turns them on, only she can see or change them,
 * and every change is recorded. Nothing uses them yet: no research runs and no predictions ship; the
 * switches exist now so the record of what she chose starts on day one.
 */
import { HandoffError } from "@kinpath/core";
import { asActor, audit, type Actor, type Db } from "./client";

export interface DataChoices { research: boolean; researchChangedAt: string | null; predictions: boolean; predictionsChangedAt: string | null }
const OFF: DataChoices = { research: false, researchChangedAt: null, predictions: false, predictionsChangedAt: null };

export async function dataChoices(db: Db, actor: Actor, patientId: string): Promise<DataChoices> {
  return asActor(db, actor, async (tx) => {
    const r = await tx.query<{ research: boolean; research_changed_at: Date | null; predictions: boolean; predictions_changed_at: Date | null }>(
      `SELECT research, research_changed_at, predictions, predictions_changed_at FROM data_choices WHERE patient_id = $1`, [patientId]);
    const x = r.rows[0];
    if (!x) return OFF;
    const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
    return { research: x.research, researchChangedAt: iso(x.research_changed_at), predictions: x.predictions, predictionsChangedAt: iso(x.predictions_changed_at) };
  });
}

export async function setDataChoice(db: Db, actor: Actor, patientId: string, choice: "research" | "predictions", on: boolean) {
  if (choice !== "research" && choice !== "predictions") throw new HandoffError("Unknown choice.");
  if (actor.role !== "patient") throw new HandoffError("Only she can change this.");
  await asActor(db, actor, async (tx) => {
    await tx.query(
      `INSERT INTO data_choices (patient_id, clinic_id, ${choice}, ${choice}_changed_at) VALUES ($1,$2,$3,now())
       ON CONFLICT (patient_id) DO UPDATE SET ${choice} = EXCLUDED.${choice}, ${choice}_changed_at = now()`, [patientId, actor.clinicId, on]);
    await audit(tx, actor, `patient.${on ? "allowed" : "stopped"}_${choice}`, patientId, {});
  });
  return dataChoices(db, actor, patientId);
}

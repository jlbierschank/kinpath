/**
 * SYNTHETIC DATA ONLY. Two fictional clinics so tests can prove they can't see each other.
 * Medical values and protocol text are placeholders for an IVF nurse to replace.
 */
import type { Db } from "./client";

/** scrypt hash of the demo staff password "bayside demo 2026". Synthetic seed accounts only. */
export const DEMO_STAFF_PASSWORD = "bayside demo 2026";
const DEMO_STAFF_PASSWORD_HASH = "scrypt$16384$8$1$AoryJqPoWqlQ9h7iR43y6Q==$NZpRY2FQ6ItfKSpsAXUzEAMHkB0cK1b0UBxIBTgSx+I=";

export const IDS = {
  bayside: "bayside",
  harbor: "harbor",
  maria: "00000000-0000-4000-8000-000000000001",
  patel: "00000000-0000-4000-8000-000000000002",
  sam: "00000000-0000-4000-8000-000000000003",
  kara: "00000000-0000-4000-8000-000000000004",
  mayaUser: "00000000-0000-4000-8000-000000000010",
  jordan: "00000000-0000-4000-8000-000000000011",
  priyaUser: "00000000-0000-4000-8000-000000000012",
  harborNurse: "00000000-0000-4000-8000-000000000020",
  harborPatientUser: "00000000-0000-4000-8000-000000000021",
  maya: "00000000-0000-4000-8000-000000000100",
  priya: "00000000-0000-4000-8000-000000000101",
  harborPatient: "00000000-0000-4000-8000-000000000102",
  mayaCycle: "00000000-0000-4000-8000-000000000200",
  gonalF: "00000000-0000-4000-8000-000000000300",
  menopur: "00000000-0000-4000-8000-000000000301",
  cetrotide: "00000000-0000-4000-8000-000000000302",
  harborCycle: "00000000-0000-4000-8000-000000000201",
  harborMed: "00000000-0000-4000-8000-000000000303",
} as const;

/** Runs as the database owner, before the app ever connects. */
export async function seed(db: Db, now = new Date("2026-10-26T09:00:00-04:00")): Promise<void> {
  const i = IDS;
  // Anchor the story so "tonight's 8 pm injections" are always still ahead, even when seeding late in the evening.
  const anchor = new Date(now);
  if (anchor.getHours() >= 19) anchor.setDate(anchor.getDate() + 1);
  const day = (offsetDays: number, hhmm: string) => {
    const d = new Date(anchor);
    d.setDate(d.getDate() + offsetDays);
    const [h, m] = hhmm.split(":").map(Number);
    d.setHours(h ?? 0, m ?? 0, 0, 0);
    return d.toISOString();
  };
  await db.transaction(async (tx) => {
    await tx.query(`INSERT INTO clinics (id, name) VALUES ($1, 'Bayside Fertility'), ($2, 'Harbor Fertility')`, [i.bayside, i.harbor]);
    const users: [string, string, string, string, string, string][] = [
      [i.maria, i.bayside, "nurse", "Maria Lopez, RN", "maria@bayside.example", "en"],
      [i.patel, i.bayside, "physician", "Dr. Anil Patel", "patel@bayside.example", "en"],
      [i.sam, i.bayside, "financial_counselor", "Sam Kim", "sam@bayside.example", "en"],
      [i.kara, i.bayside, "clinic_admin", "Kara Diaz", "kara@bayside.example", "en"],
      [i.mayaUser, i.bayside, "patient", "Maya Torres", "maya@example.com", "en"],
      [i.jordan, i.bayside, "partner", "Jordan Torres", "jordan@example.com", "en"],
      [i.priyaUser, i.bayside, "patient", "Priya Shah", "priya@example.com", "es"],
      [i.harborNurse, i.harbor, "nurse", "Lee Grant, RN", "lee@harbor.example", "en"],
      [i.harborPatientUser, i.harbor, "patient", "Dana Ruiz", "dana@example.com", "en"],
    ];
    for (const u of users) {
      await tx.query(`INSERT INTO app_users (id, clinic_id, role, display_name, email, preferred_lang) VALUES ($1,$2,$3,$4,$5,$6)`, u);
    }
    // Demo staff password for every seed staff account: "bayside demo 2026" (synthetic accounts only).
    // Two-step sign-in is set up at first sign-in, as it would be for a real new staff member.
    for (const id of [i.maria, i.patel, i.sam, i.kara, i.harborNurse]) {
      await tx.query(`INSERT INTO user_credentials (user_id, password_hash, password_changed_at) VALUES ($1,$2,now())`, [id, DEMO_STAFF_PASSWORD_HASH]);
    }
    await tx.query(`UPDATE app_users SET title = 'IVF nurse', signature = '— Maria, Bayside nursing team' WHERE id = $1`, [i.maria]);
    await tx.query(
      `INSERT INTO patients (id, clinic_id, user_id, first_name, last_name, preferred_lang, mrn) VALUES
       ($1,$4,$5,'Maya','Torres','en','BF-100231'), ($2,$4,$6,'Priya','Shah','es','BF-100245'), ($3,$7,$8,'Dana','Ruiz','en','HB-5512')`,
      [i.maya, i.priya, i.harborPatient, i.bayside, i.mayaUser, i.priyaUser, i.harbor, i.harborPatientUser],
    );
    await tx.query(`INSERT INTO partner_grants (clinic_id, patient_id, partner_user_id, sections) VALUES ($1,$2,$3,ARRAY['schedule','meds'])`, [i.bayside, i.maya, i.jordan]);
    await tx.query(
      `INSERT INTO cycles (id, clinic_id, patient_id, kind, stage, stim_day, started_on) VALUES
       ($1,$3,$4,'ivf','stimulation',6,$6), ($2,$5,$7,'ivf','stimulation',4,$6)`,
      [i.mayaCycle, i.harborCycle, i.bayside, i.maya, i.harbor, day(-5, "00:00").slice(0, 10), i.harborPatient],
    );
    await tx.query(
      `INSERT INTO med_orders (id, clinic_id, patient_id, cycle_id, medication, dose, time_of_day) VALUES
       ($1,$5,$6,$7,'Gonal-f','225 IU','20:00'), ($2,$5,$6,$7,'Menopur','75 IU','20:00'), ($3,$5,$6,$7,'Cetrotide','0.25 mg','20:00'),
       ($4,$8,$9,$10,'Follistim','200 IU','20:00')`,
      [i.gonalF, i.menopur, i.cetrotide, i.harborMed, i.bayside, i.maya, i.mayaCycle, i.harbor, i.harborPatient, i.harborCycle],
    );
    // Five nights of doses for Maya: all taken except last night's Gonal-f.
    for (let d = -5; d <= -1; d++) {
      for (const med of [i.gonalF, i.menopur]) {
        const missed = d === -1 && med === i.gonalF;
        await tx.query(
          `INSERT INTO dose_logs (clinic_id, patient_id, med_order_id, scheduled_for, taken_at) VALUES ($1,$2,$3,$4,$5)`,
          [i.bayside, i.maya, med, day(d, "20:00"), missed ? null : day(d, "20:06")],
        );
      }
    }
    // Tonight's injections, not yet due.
    for (const med of [i.gonalF, i.menopur, i.cetrotide]) {
      await tx.query(`INSERT INTO dose_logs (clinic_id, patient_id, med_order_id, scheduled_for) VALUES ($1,$2,$3,$4)`, [i.bayside, i.maya, med, day(0, "20:00")]);
    }
    const steps = (pairs: [string, string][]) => JSON.stringify(pairs.map(([en, es]) => ({ en, es })));
    const common: [string, string][] = [
      ["Wash your hands and lay everything out on a clean surface.", "Lávate las manos y coloca todo sobre una superficie limpia."],
      ["Check the medication name and the dose your nurse set. Ask before you inject if anything looks different.", "Revisa el nombre del medicamento y la dosis que fijó tu enfermera. Pregunta antes de inyectarte si algo se ve diferente."],
    ];
    const finish: [string, string][] = [
      ["Clean a spot on your belly, at least two inches from your belly button, with an alcohol swab. Let it dry.", "Limpia un área del abdomen, al menos a cinco centímetros del ombligo, con una toallita con alcohol. Deja que se seque."],
      ["Pinch the skin, insert the needle straight in, and press the plunger slowly until it stops.", "Pellizca la piel, introduce la aguja recta y presiona el émbolo despacio hasta el final."],
      ["Put the needle straight into your sharps container. Never recap it.", "Pon la aguja directamente en tu contenedor de objetos punzantes. Nunca le vuelvas a poner la tapa."],
    ];
    await tx.query(
      `INSERT INTO med_guides (clinic_id, medication, steps, approved_by, sort_order) VALUES
       ($1,'Gonal-f',$2,'Maria Lopez, RN',1), ($1,'Menopur',$3,'Maria Lopez, RN',2), ($1,'Cetrotide',$4,'Maria Lopez, RN',3)`,
      [i.bayside,
       steps([...common, ["Attach a new needle to the pen and dial to your dose.", "Coloca una aguja nueva en la pluma y gira hasta tu dosis."], ...finish]),
       steps([...common, ["Mix the powder with the liquid as your nurse showed you. Swirl gently; don't shake.", "Mezcla el polvo con el líquido como te enseñó tu enfermera. Gira suavemente; no agites."], ...finish]),
       steps([...common, ["Mix the powder with the prefilled syringe and swap to the thin injection needle.", "Mezcla el polvo con la jeringa precargada y cambia a la aguja fina de inyección."], ...finish])],
    );
    await tx.query(`INSERT INTO patient_prefs (patient_id, clinic_id) VALUES ($1,$2), ($3,$2)`, [i.maya, i.bayside, i.priya]);

    await tx.query(`INSERT INTO dose_logs (clinic_id, patient_id, med_order_id, scheduled_for, taken_at) VALUES ($1,$2,$3,$4,$5)`, [i.harbor, i.harborPatient, i.harborMed, day(-1, "20:00"), day(-1, "20:02")]);

    await tx.query(
      `INSERT INTO clinic_ranges (clinic_id, analyte, unit, day_from, day_to, low, high, in_range_en, in_range_es, approved_by) VALUES
       ($1,'estradiol','pg/mL',5,7,300,900,'Your estradiol is right where Bayside expects for this point in stimulation.','Tu estradiol está justo donde Bayside espera para este momento de la estimulación.','Maria Lopez, RN'),
       ($1,'progesterone','ng/mL',5,7,0,1.5,'Your progesterone is where Bayside expects during stimulation.','Tu progesterona está donde Bayside espera durante la estimulación.','Maria Lopez, RN')`,
      [i.bayside],
    );
    await tx.query(
      `INSERT INTO protocol_sections (clinic_id, id, title, body_en, body_es, approved_by) VALUES
       ($1,'meds.missed_dose.gonal_f','Missed Gonal-f dose',
        'If it has been less than 4 hours since your scheduled time, take your Gonal-f now. If it has been longer, skip it, take tonight''s dose as planned, and keep your monitoring appointment. Nothing else changes.',
        'Si han pasado menos de 4 horas desde tu hora programada, ponte el Gonal-f ahora. Si pasó más tiempo, sáltalo, ponte la dosis de esta noche como está planeado y mantén tu cita de monitoreo. Nada más cambia.',
        'Maria Lopez, RN'),
       ($1,'next.1_followup','A follow-up visit with your doctor',
        'A visit to talk through what happened in this cycle and what might change next time. Bring anyone you like, and any questions.',
        'Una visita para hablar de lo que pasó en este ciclo y lo que podría cambiar la próxima vez. Trae a quien quieras y todas tus preguntas.',
        'Maria Lopez, RN'),
       ($1,'next.2_fet','A frozen embryo transfer',
        'If you have embryos in storage, a frozen transfer needs fewer injections than a full cycle. Your financial counselor can give you Bayside''s current cost and what your plan covers.',
        'Si tienes embriones guardados, una transferencia de embriones congelados requiere menos inyecciones que un ciclo completo. Tu consejera financiera puede darte el costo actual de Bayside y lo que cubre tu plan.',
        'Maria Lopez, RN'),
       ($1,'next.3_new_cycle','Another full IVF cycle',
        'Some people start a new cycle with changes to the medication plan. Your doctor will talk through whether that makes sense for you.',
        'Algunas personas comienzan un nuevo ciclo con cambios en el plan de medicamentos. Tu médico hablará contigo sobre si eso tiene sentido para ti.',
        'Maria Lopez, RN'),
       ($1,'wait.cramping','Is cramping normal?',
        'Mild cramping can be normal during the wait. Call the nurse line right away for heavy bleeding, severe pain, fever, or trouble breathing.',
        'Los cólicos leves pueden ser normales durante la espera. Llama a enfermería de inmediato si tienes sangrado abundante, dolor fuerte, fiebre o dificultad para respirar.',
        'Maria Lopez, RN'),
       ($1,'wait.home_test','Should I take a home test?',
        'Home tests can be misleading this early, in either direction. Your blood test is the one to trust. Many people find it easier not to test at home.',
        'Las pruebas caseras pueden confundir tan pronto, en cualquier sentido. Confía en tu prueba de sangre. A muchas personas les resulta más fácil no hacerse pruebas en casa.',
        'Maria Lopez, RN')`,
      [i.bayside],
    );
  });
}

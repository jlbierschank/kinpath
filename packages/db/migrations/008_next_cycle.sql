-- "When you're ready": planning a next cycle after a negative result, at the patient's pace.

-- Embryos frozen at the time of transfer (pilot entry until the records-system connection).
ALTER TABLE cycles ADD COLUMN embryos_frozen int CHECK (embryos_frozen BETWEEN 0 AND 50);

-- New kinds of calls: the patient says she's ready to talk about next steps.
ALTER TABLE nurse_tasks DROP CONSTRAINT nurse_tasks_kind_check;
ALTER TABLE nurse_tasks ADD CONSTRAINT nurse_tasks_kind_check CHECK (kind IN ('wellbeing_call','result_call','negative_followup','next_steps'));
DROP POLICY patient_asks_call ON nurse_tasks;
CREATE POLICY patient_asks_call ON nurse_tasks FOR INSERT
  WITH CHECK (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id) AND kind IN ('wellbeing_call','next_steps') AND done_at IS NULL);

-- Her own questions for the follow-up visit, and when she said she was ready.
CREATE TABLE next_cycle_plans (
  patient_id uuid PRIMARY KEY REFERENCES patients(id),
  clinic_id text NOT NULL REFERENCES clinics(id),
  questions text NOT NULL DEFAULT '' CHECK (char_length(questions) <= 2000),
  ready_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE next_cycle_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_plan_read ON next_cycle_plans FOR SELECT USING (clinic_id = kp_clinic() AND (kp_is_patient_self(patient_id) OR kp_is_clinician()));
CREATE POLICY own_plan_add ON next_cycle_plans FOR INSERT WITH CHECK (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id));
CREATE POLICY own_plan_change ON next_cycle_plans FOR UPDATE USING (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id));
GRANT SELECT, INSERT, UPDATE ON next_cycle_plans TO kp_app;

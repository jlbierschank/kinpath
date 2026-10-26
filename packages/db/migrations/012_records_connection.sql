-- Records connection: lab results and medication orders arriving from the clinic's records system
-- (EHR) instead of being typed in.
--
-- Rules:
-- 1. A record is matched to a patient by medical record number (MRN) within the clinic, and the
--    last name must agree when the record carries one. Anything that doesn't match goes to a
--    nurse's review list. Nothing is ever guessed.
-- 2. Every record has an id from the records system. Sending the same record twice changes nothing.
-- 3. Lab results go through the same labeling as typed results: in range → the patient sees the
--    clinic's approved words; anything else → the nurse first.
-- 4. A pregnancy blood test (hCG) only fills in the number on the unreleased test. The nurse still
--    decides the outcome and when the patient hears it.
-- 5. Medication orders wait for a nurse to confirm before the patient's schedule changes.
-- 6. The connection signs in with a per-clinic key; only its hash is stored.

ALTER TABLE patients ADD COLUMN mrn text;
CREATE UNIQUE INDEX patients_clinic_mrn ON patients (clinic_id, mrn) WHERE mrn IS NOT NULL;

CREATE TABLE integration_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id text NOT NULL REFERENCES clinics(id),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  key_hash text NOT NULL UNIQUE,
  key_hint text NOT NULL,             -- last 4 characters, so admins can tell keys apart
  created_by uuid NOT NULL REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

CREATE TABLE record_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id text NOT NULL REFERENCES clinics(id),
  key_id uuid REFERENCES integration_keys(id),
  format text NOT NULL CHECK (format IN ('fhir','csv','sample')),
  received_at timestamptz NOT NULL DEFAULT now(),
  -- Counts only. No names, numbers or values, so admins can read the log.
  counts jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE record_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id text NOT NULL REFERENCES clinics(id),
  import_id uuid NOT NULL REFERENCES record_imports(id),
  external_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('result','hcg','med_order','med_stop')),
  status text NOT NULL CHECK (status IN ('applied','needs_review','dismissed')),
  reason text,
  patient_id uuid REFERENCES patients(id),
  mrn text,
  -- The record as Pumpkin understood it (analyte, value, unit, date; or medication, dose, time, dates).
  data jsonb NOT NULL,
  lab_result_id uuid REFERENCES lab_results(id),
  med_order_id uuid,
  reviewed_by_name text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX record_items_external ON record_items (clinic_id, kind, external_id);

-- Typed results have a person; records-system results don't.
ALTER TABLE lab_results ALTER COLUMN entered_by DROP NOT NULL;
ALTER TABLE lab_results ADD CONSTRAINT lab_results_who CHECK (entered_by IS NOT NULL OR source <> 'staff_entry');
ALTER TABLE lab_results ADD COLUMN corrected_at timestamptz;

-- Medication orders from the records system wait for a nurse.
ALTER TABLE med_orders ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending_review','stopped'));
ALTER TABLE med_orders ADD COLUMN starts_on date;
ALTER TABLE med_orders ADD COLUMN ends_on date;
ALTER TABLE med_orders ADD COLUMN external_id text;
DROP POLICY see_meds ON med_orders;
CREATE POLICY see_meds ON med_orders FOR SELECT USING (kp_can_view(patient_id, 'meds') AND (status <> 'pending_review' OR kp_is_clinician()));

ALTER TABLE integration_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE record_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE record_items ENABLE ROW LEVEL SECURITY;

-- Admins manage keys (they never see the key itself after it's created).
CREATE POLICY admin_keys ON integration_keys FOR SELECT USING (clinic_id = kp_clinic() AND kp_role() = 'clinic_admin');
-- The import log holds counts only: admins and clinicians may read it.
CREATE POLICY read_imports ON record_imports FOR SELECT USING (clinic_id = kp_clinic() AND (kp_role() = 'clinic_admin' OR kp_is_clinician()));
-- The records themselves are clinical: nurses and physicians only.
CREATE POLICY clinician_items ON record_items FOR SELECT USING (clinic_id = kp_clinic() AND kp_is_clinician());
CREATE POLICY clinician_review ON record_items FOR UPDATE USING (clinic_id = kp_clinic() AND kp_is_clinician()) WITH CHECK (clinic_id = kp_clinic() AND kp_is_clinician());

-- Key creation and the importer run as the database owner (server side), never as kp_app.
REVOKE ALL ON integration_keys FROM kp_app;
GRANT SELECT (id, clinic_id, name, key_hint, created_by, created_at, last_used_at, revoked_at) ON integration_keys TO kp_app;
GRANT SELECT ON record_imports TO kp_app;
GRANT SELECT, UPDATE (status, reason, patient_id, reviewed_by_name, reviewed_at, updated_at, lab_result_id, med_order_id) ON record_items TO kp_app;
GRANT UPDATE (status) ON med_orders TO kp_app;
CREATE POLICY clinician_meds ON med_orders FOR UPDATE USING (clinic_id = kp_clinic() AND kp_is_clinician()) WITH CHECK (clinic_id = kp_clinic() AND kp_is_clinician());
GRANT INSERT ON dose_logs TO kp_app;
CREATE POLICY clinician_add_doses ON dose_logs FOR INSERT WITH CHECK (clinic_id = kp_clinic() AND kp_is_clinician());
-- A nurse can add a confirmed order for a record that arrived without a patient match.
GRANT INSERT ON med_orders TO kp_app;
CREATE POLICY clinician_add_meds ON med_orders FOR INSERT WITH CHECK (clinic_id = kp_clinic() AND kp_is_clinician());

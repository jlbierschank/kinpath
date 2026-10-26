-- Money: cost estimates, insurance and benefits, charges and payments, financing options, and
-- questions about costs. Everything patient-specific sits in the 'money' section:
--   the patient sees her own; financial counselors see every patient's at their clinic;
--   a support person only if she shares 'money' (off by default); nurses, physicians, schedulers
--   and admins don't see it.
-- Amounts are whole cents. Pumpkin doesn't take payments yet (see docs/PAYMENTS.md).

CREATE FUNCTION kp_is_counselor() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT kp_role() = 'financial_counselor' $$;

-- ---------- estimates ----------
CREATE TABLE finance_estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id text NOT NULL REFERENCES clinics(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  note text CHECK (char_length(note) <= 1000),          -- what she reads with it
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','shared','replaced')),
  valid_until date,
  source text NOT NULL DEFAULT 'staff' CHECK (source IN ('staff','records')),
  external_id text,
  created_by_name text,
  shared_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX finance_estimates_external ON finance_estimates (clinic_id, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE finance_estimate_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id text NOT NULL REFERENCES clinics(id),
  estimate_id uuid NOT NULL REFERENCES finance_estimates(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
  category text NOT NULL DEFAULT 'other' CHECK (category IN ('clinic','medications','lab','anesthesia','storage','other')),
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  insurance_cents bigint NOT NULL DEFAULT 0 CHECK (insurance_cents >= 0 AND insurance_cents <= amount_cents),
  sort_order int NOT NULL DEFAULT 0
);

-- ---------- coverage ----------
CREATE TABLE finance_coverage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id text NOT NULL REFERENCES clinics(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  kind text NOT NULL DEFAULT 'insurance' CHECK (kind IN ('insurance','employer_benefit','self_pay')),
  payer_name text CHECK (char_length(payer_name) <= 120),
  plan_name text CHECK (char_length(plan_name) <= 120),
  member_last4 text CHECK (member_last4 ~ '^[A-Za-z0-9]{1,4}$'),   -- never the full member id
  fertility_benefit text CHECK (char_length(fertility_benefit) <= 500),
  lifetime_max_cents bigint, lifetime_used_cents bigint NOT NULL DEFAULT 0,
  cycles_max int, cycles_used int NOT NULL DEFAULT 0,
  deductible_cents bigint, deductible_met_cents bigint NOT NULL DEFAULT 0,
  oop_max_cents bigint, oop_met_cents bigint NOT NULL DEFAULT 0,
  prior_auth text NOT NULL DEFAULT 'none' CHECK (prior_auth IN ('none','needed','submitted','approved','denied')),
  ends_on date,
  active boolean NOT NULL DEFAULT true,
  source text NOT NULL DEFAULT 'staff' CHECK (source IN ('staff','records')),
  external_id text,
  updated_by_name text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX finance_coverage_external ON finance_coverage (clinic_id, external_id) WHERE external_id IS NOT NULL;

-- ---------- charges and payments ----------
CREATE TABLE finance_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id text NOT NULL REFERENCES clinics(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  kind text NOT NULL CHECK (kind IN ('charge','payment','adjustment','refund')),
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 160),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  occurred_on date NOT NULL,
  due_on date,
  method text CHECK (method IN ('card','check','cash','bank','financing','insurance','other')),
  receipt_number text,
  voided_at timestamptz,
  source text NOT NULL DEFAULT 'staff' CHECK (source IN ('staff','records')),
  external_id text,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (due_on IS NULL OR kind = 'charge')
);
CREATE UNIQUE INDEX finance_ledger_external ON finance_ledger (clinic_id, external_id) WHERE external_id IS NOT NULL;

-- ---------- financing options (clinic-wide, not patient data) ----------
CREATE TABLE finance_partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id text NOT NULL REFERENCES clinics(id),
  kind text NOT NULL CHECK (kind IN ('loan','grant','discount','employer','other')),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 400),
  url text CHECK (url ~ '^https://'),
  phone text CHECK (char_length(phone) <= 30),
  sort_order int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  updated_by_name text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- questions about costs (to the financial counselor, not the nurses) ----------
CREATE TABLE finance_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id text NOT NULL REFERENCES clinics(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  estimate_id uuid REFERENCES finance_estimates(id),
  question text NOT NULL CHECK (char_length(question) BETWEEN 1 AND 1000),
  answer text CHECK (char_length(answer) <= 2000),
  answered_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  read_at timestamptz
);

-- ---------- access ----------
ALTER TABLE finance_estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_estimate_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_coverage ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_questions ENABLE ROW LEVEL SECURITY;

-- Patients and support people see estimates only once shared; counselors see drafts too.
CREATE POLICY see_estimates ON finance_estimates FOR SELECT USING (clinic_id = kp_clinic() AND kp_can_view(patient_id, 'money') AND (status <> 'draft' OR kp_is_counselor()));
CREATE POLICY counselor_estimates ON finance_estimates FOR ALL USING (clinic_id = kp_clinic() AND kp_is_counselor()) WITH CHECK (clinic_id = kp_clinic() AND kp_is_counselor());
CREATE POLICY see_estimate_items ON finance_estimate_items FOR SELECT USING (clinic_id = kp_clinic() AND EXISTS (SELECT 1 FROM finance_estimates e WHERE e.id = estimate_id));
CREATE POLICY counselor_estimate_items ON finance_estimate_items FOR ALL USING (clinic_id = kp_clinic() AND kp_is_counselor()) WITH CHECK (clinic_id = kp_clinic() AND kp_is_counselor());

CREATE POLICY see_coverage ON finance_coverage FOR SELECT USING (clinic_id = kp_clinic() AND kp_can_view(patient_id, 'money'));
CREATE POLICY counselor_coverage ON finance_coverage FOR ALL USING (clinic_id = kp_clinic() AND kp_is_counselor()) WITH CHECK (clinic_id = kp_clinic() AND kp_is_counselor());

CREATE POLICY see_ledger ON finance_ledger FOR SELECT USING (clinic_id = kp_clinic() AND kp_can_view(patient_id, 'money'));
CREATE POLICY counselor_ledger ON finance_ledger FOR ALL USING (clinic_id = kp_clinic() AND kp_is_counselor()) WITH CHECK (clinic_id = kp_clinic() AND kp_is_counselor());

CREATE POLICY see_partners ON finance_partners FOR SELECT USING (clinic_id = kp_clinic());
CREATE POLICY manage_partners ON finance_partners FOR ALL USING (clinic_id = kp_clinic() AND kp_role() IN ('financial_counselor','clinic_admin')) WITH CHECK (clinic_id = kp_clinic() AND kp_role() IN ('financial_counselor','clinic_admin'));

-- Questions are between the patient and the counselor; support people don't see them.
CREATE POLICY see_questions ON finance_questions FOR SELECT USING (clinic_id = kp_clinic() AND (kp_is_patient_self(patient_id) OR kp_is_counselor()));
CREATE POLICY patient_asks ON finance_questions FOR INSERT WITH CHECK (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id) AND answer IS NULL);
CREATE POLICY counselor_answers ON finance_questions FOR UPDATE USING (clinic_id = kp_clinic() AND kp_is_counselor()) WITH CHECK (clinic_id = kp_clinic() AND kp_is_counselor());
CREATE POLICY patient_reads_answer ON finance_questions FOR UPDATE USING (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id) AND answer IS NOT NULL) WITH CHECK (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id));
-- A patient may only mark an answer read; everything else is locked to her.
CREATE FUNCTION kp_question_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF kp_role() = 'patient' AND (NEW.question IS DISTINCT FROM OLD.question OR NEW.answer IS DISTINCT FROM OLD.answer
     OR NEW.answered_by_name IS DISTINCT FROM OLD.answered_by_name OR NEW.answered_at IS DISTINCT FROM OLD.answered_at OR NEW.patient_id IS DISTINCT FROM OLD.patient_id) THEN
    RAISE EXCEPTION 'patients can only mark an answer as read';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER finance_question_guard BEFORE UPDATE ON finance_questions FOR EACH ROW EXECUTE FUNCTION kp_question_guard();

GRANT SELECT, INSERT, UPDATE, DELETE ON finance_estimates, finance_estimate_items, finance_coverage, finance_ledger, finance_partners TO kp_app;
GRANT SELECT, INSERT, UPDATE ON finance_questions TO kp_app;

-- Financial counselors review billing records the records connection couldn't match.
ALTER TABLE record_items DROP CONSTRAINT record_items_kind_check;
ALTER TABLE record_items ADD CONSTRAINT record_items_kind_check CHECK (kind IN ('result','hcg','med_order','med_stop','appointment','coverage','ledger','estimate'));
DROP POLICY clinician_items ON record_items;
DROP POLICY clinician_review ON record_items;
CREATE POLICY reviewer_items ON record_items FOR SELECT USING (clinic_id = kp_clinic() AND (
  (kp_is_clinician() AND kind NOT IN ('coverage','ledger','estimate')) OR (kp_is_counselor() AND kind IN ('coverage','ledger','estimate'))));
CREATE POLICY reviewer_update ON record_items FOR UPDATE
  USING (clinic_id = kp_clinic() AND ((kp_is_clinician() AND kind NOT IN ('coverage','ledger','estimate')) OR (kp_is_counselor() AND kind IN ('coverage','ledger','estimate'))))
  WITH CHECK (clinic_id = kp_clinic() AND ((kp_is_clinician() AND kind NOT IN ('coverage','ledger','estimate')) OR (kp_is_counselor() AND kind IN ('coverage','ledger','estimate'))));

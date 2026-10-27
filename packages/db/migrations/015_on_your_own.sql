-- Patients on their own: Pumpkin before (or without) a clinic.
--
-- Each person who signs up on her own gets a private space: a row in clinics with kind 'personal'.
-- That keeps every existing wall (row-level security by clinic) exactly as it is: nobody else is
-- in her space, there are no staff, and her support people see only what she shares.
-- In a personal space (and only there) the patient may add and change her own meds, results,
-- appointments and costs. In a clinic's space those still come from the clinic.

ALTER TABLE clinics ADD COLUMN kind text NOT NULL DEFAULT 'clinic' CHECK (kind IN ('clinic','personal','system'));
-- Messages sent before anyone has an account (waitlist notes, sign-up codes) belong to Pumpkin itself.
INSERT INTO clinics (id, name, kind) VALUES ('pumpkin', 'Pumpkin', 'system') ON CONFLICT (id) DO NOTHING;

CREATE FUNCTION kp_is_personal() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM clinics WHERE id = kp_clinic() AND kind = 'personal')
$$;
-- The signed-in patient, in her own personal space, acting on her own record.
CREATE FUNCTION kp_owns(p_patient uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT kp_is_personal() AND kp_is_patient_self(p_patient) $$;

-- ---------- waitlist and early access (the sign-up service only; the app role can't read it) ----------
CREATE TABLE early_access (
  identifier text PRIMARY KEY,               -- email (lowercase) or phone (digits), like sign-in
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','invited','joined')),
  source text NOT NULL DEFAULT 'app' CHECK (source IN ('app','site','import')),
  added_at timestamptz NOT NULL DEFAULT now(),
  invited_at timestamptz,
  joined_at timestamptz
);
CREATE TABLE signup_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  code_hash text NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  -- After the code checks out, a short-lived ticket lets her finish setting up (hash only).
  ticket_hash text UNIQUE
);

-- "Ask my clinic to join": the clinic's name, so Pumpkin can reach out. No health details.
CREATE TABLE clinic_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_name text NOT NULL CHECK (char_length(clinic_name) BETWEEN 2 AND 120),
  -- Kept so she can be told when her clinic joins; removed if she deletes her account.
  patient_id uuid,
  source text NOT NULL DEFAULT 'app' CHECK (source IN ('app','site')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- her profile in a personal space ----------
CREATE TABLE personal_profiles (
  patient_id uuid PRIMARY KEY REFERENCES patients(id),
  clinic_id text NOT NULL REFERENCES clinics(id),
  stage text NOT NULL CHECK (stage IN ('just_starting','in_cycle','two_week_wait','after_hard_result','freezing_eggs','between_cycles')),
  clinic_name text CHECK (char_length(clinic_name) <= 120),
  -- Her clinic's after-hours line. Without a clinic on Pumpkin, urgent symptoms go here (or 911).
  after_hours_phone text CHECK (char_length(after_hours_phone) <= 30),
  asked_clinic_at timestamptz,
  -- Calendar feed: only the hash of the secret link is kept.
  calendar_token_hash text UNIQUE,
  -- Calendar titles say only "Appointment" unless she turns detail on (calendars are often shared).
  calendar_detail boolean NOT NULL DEFAULT false,
  -- Forwarding address token (add+<token>@...). It can only add items she must confirm.
  inbox_token text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE personal_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_profile ON personal_profiles FOR ALL USING (clinic_id = kp_clinic() AND kp_owns(patient_id)) WITH CHECK (clinic_id = kp_clinic() AND kp_owns(patient_id));
GRANT SELECT, INSERT, UPDATE ON personal_profiles TO kp_app;

-- ---------- "Add anything": what she sends, and what Pumpkin read from it ----------
CREATE TABLE captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id text NOT NULL REFERENCES clinics(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  kind text NOT NULL CHECK (kind IN ('photo','pdf','text','voice','email','sample')),
  filename text CHECK (char_length(filename) <= 200),
  mime text CHECK (char_length(mime) <= 100),
  bytes bytea,
  text_input text CHECK (char_length(text_input) <= 20000),
  status text NOT NULL DEFAULT 'reading' CHECK (status IN ('reading','ready','failed','urgent')),
  problem text,
  engine text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (bytes IS NULL OR octet_length(bytes) <= 12000000)
);
CREATE TABLE capture_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capture_id uuid NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  clinic_id text NOT NULL REFERENCES clinics(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  kind text NOT NULL CHECK (kind IN ('medication','result','appointment','cost','question')),
  data jsonb NOT NULL,
  unsure text[] NOT NULL DEFAULT '{}',   -- fields Pumpkin wasn't sure it read right
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','saved','dismissed')),
  saved_ref uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
ALTER TABLE captures ENABLE ROW LEVEL SECURITY;
ALTER TABLE capture_items ENABLE ROW LEVEL SECURITY;
-- Only her. Never support people, never anyone else.
CREATE POLICY own_captures ON captures FOR ALL USING (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id)) WITH CHECK (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id));
CREATE POLICY own_capture_items ON capture_items FOR ALL USING (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id)) WITH CHECK (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON captures, capture_items TO kp_app;

-- ---------- questions for her next visit ----------
CREATE TABLE visit_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id text NOT NULL REFERENCES clinics(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  question text NOT NULL CHECK (char_length(question) BETWEEN 1 AND 500),
  asked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE visit_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_questions ON visit_questions FOR ALL USING (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id)) WITH CHECK (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON visit_questions TO kp_app;

-- ---------- what she enters herself, in her own space ----------
ALTER TABLE med_orders ADD COLUMN source text NOT NULL DEFAULT 'clinic' CHECK (source IN ('clinic','patient'));
ALTER TABLE med_orders ADD COLUMN instructions text CHECK (char_length(instructions) <= 500);
ALTER TABLE med_orders ADD COLUMN capture_id uuid REFERENCES captures(id) ON DELETE SET NULL;

ALTER TABLE lab_results ALTER COLUMN stim_day DROP NOT NULL;
-- The lab's own reference range, exactly as printed on her report. Never Pumpkin's judgment.
ALTER TABLE lab_results ADD COLUMN ref_low numeric;
ALTER TABLE lab_results ADD COLUMN ref_high numeric;
ALTER TABLE lab_results ADD COLUMN ref_text text CHECK (char_length(ref_text) <= 80);
ALTER TABLE lab_results ADD COLUMN test_name text CHECK (char_length(test_name) <= 80);
ALTER TABLE lab_results ADD COLUMN capture_id uuid REFERENCES captures(id) ON DELETE SET NULL;

ALTER TABLE appointments DROP CONSTRAINT appointments_source_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_source_check CHECK (source IN ('staff','records','patient'));
ALTER TABLE finance_ledger DROP CONSTRAINT finance_ledger_source_check;
ALTER TABLE finance_ledger ADD CONSTRAINT finance_ledger_source_check CHECK (source IN ('staff','records','patient'));
ALTER TABLE finance_ledger ADD COLUMN capture_id uuid REFERENCES captures(id) ON DELETE SET NULL;

CREATE POLICY solo_cycles ON cycles FOR ALL USING (clinic_id = kp_clinic() AND kp_owns(patient_id)) WITH CHECK (clinic_id = kp_clinic() AND kp_owns(patient_id));
CREATE POLICY solo_meds ON med_orders FOR ALL USING (clinic_id = kp_clinic() AND kp_owns(patient_id)) WITH CHECK (clinic_id = kp_clinic() AND kp_owns(patient_id) AND source = 'patient');
CREATE POLICY solo_doses ON dose_logs FOR ALL USING (clinic_id = kp_clinic() AND kp_owns(patient_id)) WITH CHECK (clinic_id = kp_clinic() AND kp_owns(patient_id));
CREATE POLICY solo_results ON lab_results FOR ALL USING (clinic_id = kp_clinic() AND kp_owns(patient_id)) WITH CHECK (clinic_id = kp_clinic() AND kp_owns(patient_id) AND source = 'patient_upload' AND entered_by = kp_user());
CREATE POLICY solo_appointments ON appointments FOR ALL USING (clinic_id = kp_clinic() AND kp_owns(patient_id)) WITH CHECK (clinic_id = kp_clinic() AND kp_owns(patient_id) AND source = 'patient');
CREATE POLICY solo_ledger ON finance_ledger FOR ALL USING (clinic_id = kp_clinic() AND kp_owns(patient_id)) WITH CHECK (clinic_id = kp_clinic() AND kp_owns(patient_id) AND source = 'patient');
GRANT SELECT, INSERT, UPDATE ON cycles TO kp_app;
GRANT UPDATE, DELETE ON med_orders TO kp_app;
GRANT DELETE ON dose_logs, lab_results, appointments TO kp_app;
GRANT UPDATE ON lab_results TO kp_app;

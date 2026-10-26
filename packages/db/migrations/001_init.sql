-- Kinpath schema v1.
-- Every row carries clinic_id. Row-level security (RLS) walls clinics apart and enforces
-- who can see each section of a patient's record. The app connects as kp_app, never as owner,
-- so these policies always apply. The same rules live in @kinpath/core/permissions.ts and a
-- test checks the two stay in sync.

CREATE ROLE kp_app NOLOGIN;

-- ---------- session identity (set per transaction by the app) ----------
CREATE FUNCTION kp_user() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
CREATE FUNCTION kp_clinic() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.clinic_id', true), '') $$;
CREATE FUNCTION kp_role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.role', true), '') $$;

-- ---------- tables ----------
CREATE TABLE clinics (
  id text PRIMARY KEY,
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'America/New_York'
);

CREATE TABLE app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id text NOT NULL REFERENCES clinics(id),
  role text NOT NULL CHECK (role IN ('nurse','physician','financial_counselor','scheduler','clinic_admin','patient','partner')),
  display_name text NOT NULL,
  email text NOT NULL,
  preferred_lang text NOT NULL DEFAULT 'en' CHECK (preferred_lang IN ('en','es')),
  UNIQUE (clinic_id, email)
);

CREATE TABLE patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id text NOT NULL REFERENCES clinics(id),
  user_id uuid NOT NULL REFERENCES app_users(id),
  first_name text NOT NULL,
  last_name text NOT NULL,
  preferred_lang text NOT NULL DEFAULT 'en' CHECK (preferred_lang IN ('en','es')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE partner_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id text NOT NULL REFERENCES clinics(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  partner_user_id uuid NOT NULL REFERENCES app_users(id),
  sections text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CHECK (sections <@ ARRAY['schedule','results','meds','money','record']::text[])  -- never 'messages'
);

CREATE TABLE cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id text NOT NULL REFERENCES clinics(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  kind text NOT NULL CHECK (kind IN ('ivf','egg_freezing','fet','iui')),
  stage text NOT NULL,
  stim_day int,
  started_on date NOT NULL
);

CREATE TABLE med_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id text NOT NULL REFERENCES clinics(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  cycle_id uuid NOT NULL REFERENCES cycles(id),
  medication text NOT NULL,
  dose text NOT NULL,
  time_of_day time NOT NULL
);

CREATE TABLE dose_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id text NOT NULL REFERENCES clinics(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  med_order_id uuid NOT NULL REFERENCES med_orders(id),
  scheduled_for timestamptz NOT NULL,
  taken_at timestamptz,
  reported_missed_at timestamptz
);

CREATE TABLE clinic_ranges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id text NOT NULL REFERENCES clinics(id),
  analyte text NOT NULL,
  unit text NOT NULL,
  day_from int NOT NULL,
  day_to int NOT NULL,
  low numeric NOT NULL,
  high numeric NOT NULL,
  in_range_en text NOT NULL,
  in_range_es text NOT NULL,
  approved_by text NOT NULL,
  CHECK (low <= high AND day_from <= day_to)
);

CREATE TABLE lab_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id text NOT NULL REFERENCES clinics(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  analyte text NOT NULL,
  unit text NOT NULL,
  value numeric NOT NULL,
  stim_day int NOT NULL,
  collected_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('in_range','below_range','above_range','no_range','unit_mismatch')),
  entered_by uuid NOT NULL REFERENCES app_users(id),
  source text NOT NULL DEFAULT 'staff_entry' CHECK (source IN ('staff_entry','emr_feed','emr_partner','patient_upload'))
);

CREATE TABLE protocol_sections (
  clinic_id text NOT NULL REFERENCES clinics(id),
  id text NOT NULL,
  title text NOT NULL,
  body_en text NOT NULL,
  body_es text NOT NULL,
  approved_by text NOT NULL,
  PRIMARY KEY (clinic_id, id)
);

CREATE TABLE handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id text NOT NULL REFERENCES clinics(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  kind text NOT NULL CHECK (kind IN ('missed_dose','question','urgent_symptom','result_review','crisis')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','drafted','sent','read','closed')),
  patient_message text NOT NULL,
  triage jsonb NOT NULL,
  dose_log_id uuid REFERENCES dose_logs(id),
  lab_result_id uuid REFERENCES lab_results(id),
  draft text,
  draft_source text,
  sent_text text,
  sent_by uuid REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  read_at timestamptz,
  -- A draft can never exist for urgent or crisis messages. People call those patients.
  CHECK (NOT (kind IN ('urgent_symptom','crisis') AND draft IS NOT NULL))
);

CREATE TABLE consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id text NOT NULL REFERENCES clinics(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  form text NOT NULL,
  signed_by uuid NOT NULL REFERENCES app_users(id),
  signed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_events (
  id bigserial PRIMARY KEY,
  clinic_id text NOT NULL REFERENCES clinics(id),
  actor_user_id uuid NOT NULL,
  action text NOT NULL,
  patient_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  at timestamptz NOT NULL DEFAULT now()
);

-- ---------- access helpers ----------
-- Staff section matrix. Must match STAFF_SECTIONS in packages/core/src/permissions.ts.
CREATE FUNCTION kp_staff_sections(role text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE role
    WHEN 'nurse' THEN ARRAY['schedule','results','meds','record','messages']
    WHEN 'physician' THEN ARRAY['schedule','results','meds','record','messages']
    WHEN 'financial_counselor' THEN ARRAY['schedule','money']
    WHEN 'scheduler' THEN ARRAY['schedule']
    ELSE ARRAY[]::text[] END
$$;

-- SECURITY DEFINER so it can read patients and grants regardless of the caller's own row access.
CREATE FUNCTION kp_can_view(p_patient uuid, p_section text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM patients p
    WHERE p.id = p_patient AND p.clinic_id = kp_clinic()
      AND (
        (kp_role() = 'patient' AND p.user_id = kp_user())
        OR (kp_role() = 'partner' AND p_section <> 'messages' AND EXISTS (
              SELECT 1 FROM partner_grants g
              WHERE g.patient_id = p.id AND g.partner_user_id = kp_user()
                AND g.revoked_at IS NULL AND p_section = ANY (g.sections)))
        OR (p_section = ANY (kp_staff_sections(kp_role())))
      )
  )
$$;

CREATE FUNCTION kp_is_patient_self(p_patient uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT kp_role() = 'patient' AND EXISTS (SELECT 1 FROM patients WHERE id = p_patient AND user_id = kp_user() AND clinic_id = kp_clinic())
$$;

CREATE FUNCTION kp_is_clinician() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT kp_role() IN ('nurse','physician') $$;

-- ---------- row-level security ----------
ALTER TABLE clinics ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE med_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE dose_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_ranges ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE protocol_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY own_clinic ON clinics FOR SELECT USING (id = kp_clinic());
CREATE POLICY same_clinic ON app_users FOR SELECT USING (clinic_id = kp_clinic());

CREATE POLICY see_patient ON patients FOR SELECT USING (
  clinic_id = kp_clinic() AND (
    kp_can_view(id, 'schedule') OR kp_can_view(id, 'meds') OR kp_can_view(id, 'results')
    OR kp_can_view(id, 'money') OR kp_can_view(id, 'record')));

CREATE POLICY see_grants ON partner_grants FOR SELECT USING (
  clinic_id = kp_clinic() AND (kp_is_patient_self(patient_id) OR partner_user_id = kp_user() OR kp_is_clinician()));
CREATE POLICY patient_grants ON partner_grants FOR INSERT WITH CHECK (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id));
CREATE POLICY patient_revokes ON partner_grants FOR UPDATE USING (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id));

CREATE POLICY see_cycles ON cycles FOR SELECT USING (kp_can_view(patient_id, 'schedule'));
CREATE POLICY see_meds ON med_orders FOR SELECT USING (kp_can_view(patient_id, 'meds'));
CREATE POLICY see_doses ON dose_logs FOR SELECT USING (kp_can_view(patient_id, 'meds'));
CREATE POLICY log_doses ON dose_logs FOR UPDATE USING (clinic_id = kp_clinic() AND (kp_is_patient_self(patient_id) OR kp_is_clinician()));

CREATE POLICY see_ranges ON clinic_ranges FOR SELECT USING (clinic_id = kp_clinic());
CREATE POLICY see_results ON lab_results FOR SELECT USING (kp_can_view(patient_id, 'results'));
CREATE POLICY enter_results ON lab_results FOR INSERT WITH CHECK (clinic_id = kp_clinic() AND kp_is_clinician() AND entered_by = kp_user());

CREATE POLICY see_protocol ON protocol_sections FOR SELECT USING (clinic_id = kp_clinic());

CREATE POLICY see_handoffs ON handoffs FOR SELECT USING (kp_can_view(patient_id, 'messages'));
CREATE POLICY patient_writes ON handoffs FOR INSERT WITH CHECK (clinic_id = kp_clinic() AND (kp_is_patient_self(patient_id) OR kp_is_clinician()));
CREATE POLICY clinician_updates ON handoffs FOR UPDATE USING (clinic_id = kp_clinic() AND kp_is_clinician());
CREATE POLICY patient_reads ON handoffs FOR UPDATE
  USING (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id) AND status = 'sent')
  WITH CHECK (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id) AND status = 'read');

-- Patients may only mark replies read and log their own doses; every other column is locked to them.
CREATE FUNCTION kp_patient_handoff_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF kp_role() = 'patient' AND (
       NEW.patient_message IS DISTINCT FROM OLD.patient_message OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.triage IS DISTINCT FROM OLD.triage OR NEW.draft IS DISTINCT FROM OLD.draft
    OR NEW.sent_text IS DISTINCT FROM OLD.sent_text OR NEW.sent_by IS DISTINCT FROM OLD.sent_by
    OR NEW.sent_at IS DISTINCT FROM OLD.sent_at) THEN
    RAISE EXCEPTION 'patients can only mark a reply as read';
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION kp_patient_dose_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF kp_role() = 'patient' AND (
       NEW.scheduled_for IS DISTINCT FROM OLD.scheduled_for OR NEW.med_order_id IS DISTINCT FROM OLD.med_order_id
    OR NEW.patient_id IS DISTINCT FROM OLD.patient_id) THEN
    RAISE EXCEPTION 'patients can only log or report a dose';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER handoffs_patient_guard BEFORE UPDATE ON handoffs FOR EACH ROW EXECUTE FUNCTION kp_patient_handoff_guard();
CREATE TRIGGER doses_patient_guard BEFORE UPDATE ON dose_logs FOR EACH ROW EXECUTE FUNCTION kp_patient_dose_guard();

CREATE POLICY see_consents ON consents FOR SELECT USING (kp_can_view(patient_id, 'record'));
CREATE POLICY sign_consents ON consents FOR INSERT WITH CHECK (clinic_id = kp_clinic() AND signed_by = kp_user());

-- Audit log: anyone can append for themselves in their clinic; only clinic admins read it;
-- no one can change or delete it (no UPDATE or DELETE policy exists, and grants are withheld below).
CREATE POLICY append_audit ON audit_events FOR INSERT WITH CHECK (clinic_id = kp_clinic() AND actor_user_id = kp_user());
CREATE POLICY read_audit ON audit_events FOR SELECT USING (clinic_id = kp_clinic() AND kp_role() = 'clinic_admin');

-- ---------- grants to the app role ----------
GRANT SELECT ON ALL TABLES IN SCHEMA public TO kp_app;
GRANT INSERT ON partner_grants, lab_results, handoffs, consents, audit_events TO kp_app;
GRANT UPDATE ON partner_grants, dose_logs, handoffs TO kp_app;
GRANT USAGE ON SEQUENCE audit_events_id_seq TO kp_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO kp_app;

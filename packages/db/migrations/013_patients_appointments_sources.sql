-- Patients added by staff, appointments, HL7 v2 and uploaded files, and pulling from a records
-- system's FHIR API (SMART Backend Services).

-- ---------- appointments ----------
CREATE TABLE appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id text NOT NULL REFERENCES clinics(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  starts_at timestamptz NOT NULL,
  kind text NOT NULL CHECK (kind IN ('monitoring','blood_test','consult','retrieval','transfer','procedure','other')),
  -- What the patient sees, e.g. "Monitoring visit: ultrasound and blood work".
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  location text CHECK (char_length(location) <= 160),
  status text NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','cancelled')),
  source text NOT NULL DEFAULT 'staff' CHECK (source IN ('staff','records')),
  external_id text,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX appointments_external ON appointments (clinic_id, external_id) WHERE external_id IS NOT NULL;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
-- The patient, support people she shares her schedule with, and staff who see schedules.
CREATE POLICY see_appointments ON appointments FOR SELECT USING (clinic_id = kp_clinic() AND kp_can_view(patient_id, 'schedule'));
CREATE POLICY staff_book ON appointments FOR INSERT WITH CHECK (clinic_id = kp_clinic() AND kp_role() IN ('nurse','physician','scheduler') AND kp_can_view(patient_id, 'schedule'));
CREATE POLICY staff_change ON appointments FOR UPDATE USING (clinic_id = kp_clinic() AND kp_role() IN ('nurse','physician','scheduler')) WITH CHECK (clinic_id = kp_clinic() AND kp_role() IN ('nurse','physician','scheduler'));
GRANT SELECT, INSERT, UPDATE ON appointments TO kp_app;

-- ---------- patients added by staff ----------
ALTER TABLE patients ADD COLUMN added_by_name text;
-- Who can see the patient list to add or edit: nurses, physicians, schedulers (already covered by
-- see_patient via kp_can_view 'schedule'). Writes go through server code as the owner, after a role check.

-- ---------- records: more kinds and formats ----------
ALTER TABLE record_items DROP CONSTRAINT record_items_kind_check;
ALTER TABLE record_items ADD CONSTRAINT record_items_kind_check CHECK (kind IN ('result','hcg','med_order','med_stop','appointment'));
ALTER TABLE record_imports DROP CONSTRAINT record_imports_format_check;
ALTER TABLE record_imports ADD CONSTRAINT record_imports_format_check CHECK (format IN ('fhir','csv','sample','hl7','upload','pull'));
ALTER TABLE record_imports ADD COLUMN uploaded_by_name text;

-- ---------- pulling from the records system's FHIR API ----------
-- Pumpkin makes its own key pair per clinic. The public half is published as a JWK Set for the
-- records system; the private half is stored encrypted with the server's secret (KINPATH_SECRET_KEY).
CREATE TABLE fhir_sources (
  clinic_id text PRIMARY KEY REFERENCES clinics(id),
  base_url text,
  token_url text,
  client_id text,
  scope text NOT NULL DEFAULT 'system/Patient.rs system/Observation.rs system/MedicationRequest.rs system/Appointment.rs',
  mrn_system text,
  kid text NOT NULL,
  public_jwk jsonb NOT NULL,
  private_key_enc text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  last_pulled_at timestamptz,
  last_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE fhir_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_sources ON fhir_sources FOR SELECT USING (clinic_id = kp_clinic() AND kp_role() = 'clinic_admin');
REVOKE ALL ON fhir_sources FROM kp_app;
GRANT SELECT (clinic_id, base_url, token_url, client_id, scope, mrn_system, kid, public_jwk, enabled, last_pulled_at, last_status, created_at, updated_at) ON fhir_sources TO kp_app;

-- Patients' ids in the records system's FHIR API, learned by searching on MRN.
CREATE TABLE fhir_patient_links (
  clinic_id text NOT NULL REFERENCES clinics(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  fhir_id text NOT NULL,
  PRIMARY KEY (clinic_id, patient_id)
);
ALTER TABLE fhir_patient_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fhir_patient_links FROM kp_app;

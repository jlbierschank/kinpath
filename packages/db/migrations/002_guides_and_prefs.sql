-- Injection walkthroughs (written and approved by the clinic's nurses) and patient reminder settings.

CREATE TABLE med_guides (
  clinic_id text NOT NULL REFERENCES clinics(id),
  medication text NOT NULL,
  -- [{ "en": "...", "es": "..." }, ...] in order
  steps jsonb NOT NULL,
  video_url text,
  approved_by text NOT NULL,
  PRIMARY KEY (clinic_id, medication)
);

CREATE TABLE patient_prefs (
  patient_id uuid PRIMARY KEY REFERENCES patients(id),
  clinic_id text NOT NULL REFERENCES clinics(id),
  lead_minutes int NOT NULL DEFAULT 15 CHECK (lead_minutes BETWEEN 0 AND 120),
  follow_up_minutes int NOT NULL DEFAULT 60 CHECK (follow_up_minutes BETWEEN 15 AND 240),
  quiet_start time NOT NULL DEFAULT '21:30',
  quiet_end time NOT NULL DEFAULT '07:00',
  lock_screen_detail boolean NOT NULL DEFAULT false
);

ALTER TABLE med_guides ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_prefs ENABLE ROW LEVEL SECURITY;

-- Guides are clinic content, not patient data: anyone in the clinic can read them.
CREATE POLICY see_guides ON med_guides FOR SELECT USING (clinic_id = kp_clinic());

CREATE POLICY own_prefs_read ON patient_prefs FOR SELECT USING (kp_is_patient_self(patient_id));
CREATE POLICY own_prefs_insert ON patient_prefs FOR INSERT WITH CHECK (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id));
CREATE POLICY own_prefs_update ON patient_prefs FOR UPDATE USING (kp_is_patient_self(patient_id));

GRANT SELECT ON med_guides, patient_prefs TO kp_app;
GRANT INSERT, UPDATE ON patient_prefs TO kp_app;

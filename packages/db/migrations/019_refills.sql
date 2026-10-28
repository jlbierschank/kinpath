-- Refill countdown: how many doses of a medication she has on hand, counted at a moment in time.
-- Doses left = that count minus the doses she has logged since. Only she can see or change it.
CREATE TABLE med_supplies (
  clinic_id text NOT NULL REFERENCES clinics(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  medication text NOT NULL CHECK (char_length(medication) BETWEEN 1 AND 120),
  doses int NOT NULL CHECK (doses BETWEEN 0 AND 1000),
  counted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (patient_id, medication)
);
ALTER TABLE med_supplies ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_supplies ON med_supplies FOR ALL USING (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id)) WITH CHECK (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON med_supplies TO kp_app;

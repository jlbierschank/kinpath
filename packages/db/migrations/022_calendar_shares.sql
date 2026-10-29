-- Her visits on someone else's calendar: a separate subscription link for each person she picks,
-- so she can stop one without touching the others. Titles say only "Appointment" unless she chooses detail.
CREATE TABLE calendar_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id text NOT NULL REFERENCES clinics(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),
  token_hash text NOT NULL UNIQUE,
  detail boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
ALTER TABLE calendar_shares ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_calendar_shares ON calendar_shares FOR ALL USING (clinic_id = kp_clinic() AND kp_owns(patient_id)) WITH CHECK (clinic_id = kp_clinic() AND kp_owns(patient_id));
GRANT SELECT, INSERT, UPDATE ON calendar_shares TO kp_app;

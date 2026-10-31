-- Denial letters she keeps (4.8).

ALTER TABLE capture_items DROP CONSTRAINT IF EXISTS capture_items_kind_check;
ALTER TABLE capture_items ADD CONSTRAINT capture_items_kind_check CHECK (kind IN ('medication','result','appointment','cost','question','coverage','denial'));

-- A claim or prior authorization her insurer said no to, copied from the letter. Only she sees it.
-- The appeal deadline is only what the letter prints; Pumpkin never works one out.
CREATE TABLE insurance_denials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id text NOT NULL REFERENCES clinics(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  payer text CHECK (char_length(payer) <= 80),
  reason text CHECK (char_length(reason) <= 500),
  claim_number text CHECK (char_length(claim_number) <= 40),
  service text CHECK (char_length(service) <= 160),
  service_date date,
  denied_on date,
  appeal_by date,
  amount_cents bigint CHECK (amount_cents IS NULL OR amount_cents >= 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','appealed','resolved')),
  status_changed_at timestamptz,
  capture_id uuid REFERENCES captures(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE insurance_denials ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_denials ON insurance_denials FOR ALL USING (clinic_id = kp_clinic() AND kp_is_personal() AND kp_is_patient_self(patient_id)) WITH CHECK (clinic_id = kp_clinic() AND kp_is_personal() AND kp_is_patient_self(patient_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON insurance_denials TO kp_app;

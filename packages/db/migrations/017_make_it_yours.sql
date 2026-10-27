-- "Make Pumpkin yours" and "How Pumpkin talks to me".
-- Only the patient can read or change these. Not her support people, not clinic staff, not the
-- community. Identity and health answers need her consent first (enforced in the app layer and
-- checked here), and withdrawing consent clears them.

CREATE TABLE patient_about (
  patient_id uuid PRIMARY KEY REFERENCES patients(id),
  clinic_id text NOT NULL REFERENCES clinics(id),
  -- How to address her
  preferred_name text CHECK (char_length(preferred_name) <= 60),
  pronunciation text CHECK (char_length(pronunciation) <= 80),
  pronouns text CHECK (char_length(pronouns) <= 40),
  -- Sensitive (needs consent): identity, family path, health background
  sensitive_consent_at timestamptz,
  gender text CHECK (char_length(gender) <= 60),
  family_path text[] NOT NULL DEFAULT '{}',
  partner_name text CHECK (char_length(partner_name) <= 60),
  partner_pronouns text CHECK (char_length(partner_pronouns) <= 40),
  partner_title text CHECK (char_length(partner_title) <= 30),
  conditions text[] NOT NULL DEFAULT '{}',
  conditions_other text CHECK (char_length(conditions_other) <= 300),
  past_cycles int CHECK (past_cycles BETWEEN 0 AND 50),
  past_loss text CHECK (past_loss IN ('yes','no','skip')),
  allergies text CHECK (char_length(allergies) <= 300),
  -- How Pumpkin talks to her
  tone text NOT NULL DEFAULT 'facts' CHECK (tone IN ('facts','reassure')),
  reveal_results boolean NOT NULL DEFAULT false,      -- new numbers wait behind "Ready to see it?"
  cost_checkins text NOT NULL DEFAULT 'always' CHECK (cost_checkins IN ('always','when_due')),
  pause_until timestamptz,                            -- everything but med reminders goes quiet
  on_break boolean NOT NULL DEFAULT false,            -- quiet until she comes back
  -- Community (opens later): an alias never shown with her name
  alias text CHECK (alias ~ '^[A-Za-z0-9][A-Za-z0-9 _.-]{1,22}[A-Za-z0-9]$'),
  alias_icon text CHECK (alias_icon IN ('heart','people','calendar','pen','doc','eye','tag','shield')),
  alias_tint text CHECK (alias_tint IN ('lav','sage','clay','oat')),
  alias_shows text[] NOT NULL DEFAULT '{}' CHECK (alias_shows <@ ARRAY['stage','path']::text[]),
  steps_done text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (sensitive_consent_at IS NOT NULL OR (gender IS NULL AND family_path = '{}' AND partner_name IS NULL AND partner_pronouns IS NULL
         AND partner_title IS NULL AND conditions = '{}' AND conditions_other IS NULL AND past_cycles IS NULL AND past_loss IS NULL AND allergies IS NULL))
);
CREATE UNIQUE INDEX patient_about_alias ON patient_about (lower(alias)) WHERE alias IS NOT NULL;

-- Dates she wants handled gently (a loss, a would-have-been due date, a holiday). The label is private.
CREATE TABLE tender_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id),
  clinic_id text NOT NULL REFERENCES clinics(id),
  month int NOT NULL CHECK (month BETWEEN 1 AND 12),
  day int NOT NULL CHECK (day BETWEEN 1 AND 31),
  year int CHECK (year BETWEEN 2000 AND 2100),        -- null = every year
  label text CHECK (char_length(label) <= 60),
  mode text NOT NULL DEFAULT 'quiet' CHECK (mode IN ('quiet','gentle')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE patient_about ENABLE ROW LEVEL SECURITY;
ALTER TABLE tender_dates ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_about ON patient_about FOR ALL USING (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id)) WITH CHECK (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id));
CREATE POLICY own_tender ON tender_dates FOR ALL USING (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id)) WITH CHECK (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id));
GRANT SELECT, INSERT, UPDATE ON patient_about TO kp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tender_dates TO kp_app;

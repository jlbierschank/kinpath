-- Clinic settings: nurses and physicians edit what patients see, and every change is recorded.

ALTER TABLE med_guides ADD COLUMN sort_order int NOT NULL DEFAULT 100;
ALTER TABLE med_guides ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE clinic_ranges ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE protocol_sections ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

-- Extra urgent words a clinic adds. Built-in rules live in code and can't be removed.
CREATE TABLE clinic_triage_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id text NOT NULL REFERENCES clinics(id),
  term text NOT NULL,
  level text NOT NULL CHECK (level IN ('urgent','crisis')),
  added_by text NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, term)
);

-- Who changed which piece of patient-facing content, from what, to what. Append-only.
CREATE TABLE content_changes (
  id bigserial PRIMARY KEY,
  clinic_id text NOT NULL REFERENCES clinics(id),
  changed_by uuid NOT NULL REFERENCES app_users(id),
  changed_by_name text NOT NULL,
  area text NOT NULL CHECK (area IN ('range','protocol','walkthrough','urgent_word')),
  item text NOT NULL,
  action text NOT NULL CHECK (action IN ('created','updated','removed','reordered')),
  before jsonb,
  after jsonb,
  at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE clinic_triage_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_changes ENABLE ROW LEVEL SECURITY;

-- Staff in the clinic can read settings; patients don't need the raw term list.
CREATE POLICY see_terms ON clinic_triage_terms FOR SELECT USING (clinic_id = kp_clinic() AND kp_role() NOT IN ('patient','partner'));
-- The server applies clinic terms to patient messages; patients need read access only inside that check.
CREATE POLICY patient_terms ON clinic_triage_terms FOR SELECT USING (clinic_id = kp_clinic() AND kp_role() = 'patient');
CREATE POLICY edit_terms ON clinic_triage_terms FOR INSERT WITH CHECK (clinic_id = kp_clinic() AND kp_is_clinician());
CREATE POLICY drop_terms ON clinic_triage_terms FOR DELETE USING (clinic_id = kp_clinic() AND kp_is_clinician());

CREATE POLICY edit_ranges ON clinic_ranges FOR INSERT WITH CHECK (clinic_id = kp_clinic() AND kp_is_clinician());
CREATE POLICY update_ranges ON clinic_ranges FOR UPDATE USING (clinic_id = kp_clinic() AND kp_is_clinician());
CREATE POLICY drop_ranges ON clinic_ranges FOR DELETE USING (clinic_id = kp_clinic() AND kp_is_clinician());
CREATE POLICY edit_protocol ON protocol_sections FOR INSERT WITH CHECK (clinic_id = kp_clinic() AND kp_is_clinician());
CREATE POLICY update_protocol ON protocol_sections FOR UPDATE USING (clinic_id = kp_clinic() AND kp_is_clinician());
CREATE POLICY update_guides ON med_guides FOR UPDATE USING (clinic_id = kp_clinic() AND kp_is_clinician());

CREATE POLICY see_changes ON content_changes FOR SELECT USING (clinic_id = kp_clinic() AND kp_role() IN ('nurse','physician','clinic_admin'));
CREATE POLICY log_changes ON content_changes FOR INSERT WITH CHECK (clinic_id = kp_clinic() AND kp_is_clinician() AND changed_by = kp_user());

GRANT SELECT, INSERT, DELETE ON clinic_triage_terms TO kp_app;
GRANT SELECT, INSERT ON content_changes TO kp_app;
GRANT USAGE ON SEQUENCE content_changes_id_seq TO kp_app;
GRANT INSERT, UPDATE, DELETE ON clinic_ranges TO kp_app;
GRANT INSERT, UPDATE ON protocol_sections TO kp_app;
GRANT UPDATE ON med_guides TO kp_app;

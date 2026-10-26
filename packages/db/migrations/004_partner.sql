-- Partner side: short notes from a partner to the patient, and the patient's sharing controls.
-- Notes are private between the two of them. Clinic staff can't read them, so they never become
-- a clinical record. A partner who mentions an urgent symptom is told to call, right in the app.

CREATE FUNCTION kp_is_partner_of(p_patient uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT kp_role() = 'partner' AND EXISTS (
    SELECT 1 FROM partner_grants g
    WHERE g.patient_id = p_patient AND g.partner_user_id = kp_user() AND g.clinic_id = kp_clinic()
      AND g.revoked_at IS NULL AND cardinality(g.sections) > 0)
$$;

-- The patient can see her partner's name; the partner can see the patient's name.
CREATE FUNCTION kp_partner_names(p_patient uuid)
RETURNS TABLE (partner_user_id uuid, partner_name text, sections text[], revoked boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT g.partner_user_id, u.display_name, g.sections, g.revoked_at IS NOT NULL
  FROM partner_grants g JOIN app_users u ON u.id = g.partner_user_id
  WHERE g.patient_id = p_patient AND g.clinic_id = kp_clinic() AND kp_is_patient_self(p_patient)
  ORDER BY g.created_at
$$;

CREATE TABLE partner_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id text NOT NULL REFERENCES clinics(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  from_user_id uuid NOT NULL REFERENCES app_users(id),
  from_name text NOT NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  -- Triage of the note's words. An urgent note shows the patient a "call the nurse line" card, not "Thanks".
  level text NOT NULL DEFAULT 'routine' CHECK (level IN ('routine','urgent','crisis')),
  created_at timestamptz NOT NULL DEFAULT now(),
  seen_at timestamptz
);

ALTER TABLE partner_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY read_notes ON partner_notes FOR SELECT USING (
  clinic_id = kp_clinic() AND (kp_is_patient_self(patient_id) OR from_user_id = kp_user()));
CREATE POLICY write_notes ON partner_notes FOR INSERT WITH CHECK (
  clinic_id = kp_clinic() AND from_user_id = kp_user() AND kp_is_partner_of(patient_id));
CREATE POLICY see_notes ON partner_notes FOR UPDATE
  USING (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id))
  WITH CHECK (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id));

-- The patient may only mark a note seen.
CREATE FUNCTION kp_note_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.body IS DISTINCT FROM OLD.body OR NEW.from_user_id IS DISTINCT FROM OLD.from_user_id
     OR NEW.from_name IS DISTINCT FROM OLD.from_name OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
     OR NEW.level IS DISTINCT FROM OLD.level
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'notes can only be marked seen';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER notes_guard BEFORE UPDATE ON partner_notes FOR EACH ROW EXECUTE FUNCTION kp_note_guard();

-- A partner can never change grants, even his own (the existing policy already limits UPDATE to
-- the patient). Sections stay limited by the CHECK on partner_grants: messages can never be shared.

-- Partners' notes are checked against the clinic's added urgent words too.
CREATE POLICY partner_terms ON clinic_triage_terms FOR SELECT USING (clinic_id = kp_clinic() AND kp_role() = 'partner');

GRANT SELECT, INSERT, UPDATE ON partner_notes TO kp_app;
GRANT EXECUTE ON FUNCTION kp_is_partner_of(uuid), kp_partner_names(uuid) TO kp_app;

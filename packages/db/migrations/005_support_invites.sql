-- Support people: a patient invites a partner, family member or friend and picks what they see.
-- An invite is a one-time code that expires in 7 days. Only a hash of the code is stored.

ALTER TABLE partner_grants ADD COLUMN relationship text NOT NULL DEFAULT 'partner'
  CHECK (relationship IN ('partner','family','friend','other'));
-- Removing someone ends their access and takes them off the patient's list.
-- (Switching every section off only pauses access; the person stays on her list.)
ALTER TABLE partner_grants ADD COLUMN removed_at timestamptz;

CREATE TABLE support_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id text NOT NULL REFERENCES clinics(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  invited_by uuid NOT NULL REFERENCES app_users(id),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  relationship text NOT NULL CHECK (relationship IN ('partner','family','friend','other')),
  contact text NOT NULL CHECK (char_length(contact) BETWEEN 3 AND 200),
  sections text[] NOT NULL CHECK (sections <@ ARRAY['schedule','meds','results']::text[] AND cardinality(sections) > 0),
  code_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  accepted_at timestamptz,
  accepted_user_id uuid REFERENCES app_users(id),
  canceled_at timestamptz
);

ALTER TABLE support_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_invites_read ON support_invites FOR SELECT USING (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id));
CREATE POLICY own_invites_add ON support_invites FOR INSERT WITH CHECK (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id) AND invited_by = kp_user());
CREATE POLICY own_invites_cancel ON support_invites FOR UPDATE
  USING (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id))
  WITH CHECK (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id));

-- Through the app role, a patient may only cancel an invite. Accepting runs in kp_accept_invite.
CREATE FUNCTION kp_invite_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'kp_app' AND (
       NEW.code_hash IS DISTINCT FROM OLD.code_hash OR NEW.sections IS DISTINCT FROM OLD.sections
    OR NEW.patient_id IS DISTINCT FROM OLD.patient_id OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at OR NEW.accepted_user_id IS DISTINCT FROM OLD.accepted_user_id
    OR NEW.contact IS DISTINCT FROM OLD.contact OR NEW.name IS DISTINCT FROM OLD.name) THEN
    RAISE EXCEPTION 'an invite can only be canceled';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invites_guard BEFORE UPDATE ON support_invites FOR EACH ROW EXECUTE FUNCTION kp_invite_guard();

-- Grant checks now also respect removal.
CREATE OR REPLACE FUNCTION kp_can_view(p_patient uuid, p_section text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM patients p
    WHERE p.id = p_patient AND p.clinic_id = kp_clinic()
      AND (
        (kp_role() = 'patient' AND p.user_id = kp_user())
        OR (kp_role() = 'partner' AND p_section <> 'messages' AND EXISTS (
              SELECT 1 FROM partner_grants g
              WHERE g.patient_id = p.id AND g.partner_user_id = kp_user()
                AND g.revoked_at IS NULL AND g.removed_at IS NULL AND p_section = ANY (g.sections)))
        OR (p_section = ANY (kp_staff_sections(kp_role())))
      )
  )
$$;

CREATE OR REPLACE FUNCTION kp_is_partner_of(p_patient uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT kp_role() = 'partner' AND EXISTS (
    SELECT 1 FROM partner_grants g
    WHERE g.patient_id = p_patient AND g.partner_user_id = kp_user() AND g.clinic_id = kp_clinic()
      AND g.revoked_at IS NULL AND g.removed_at IS NULL AND cardinality(g.sections) > 0)
$$;

DROP FUNCTION kp_partner_names(uuid);
CREATE FUNCTION kp_partner_names(p_patient uuid)
RETURNS TABLE (partner_user_id uuid, partner_name text, relationship text, sections text[], revoked boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT g.partner_user_id, u.display_name, g.relationship, g.sections, g.revoked_at IS NOT NULL
  FROM partner_grants g JOIN app_users u ON u.id = g.partner_user_id
  WHERE g.patient_id = p_patient AND g.clinic_id = kp_clinic() AND g.removed_at IS NULL AND kp_is_patient_self(p_patient)
  ORDER BY g.created_at
$$;

-- Accepting an invite is the one step that happens before the person has an account, like a
-- sign-up service would. It checks the code's hash, creates the support person and their access
-- in one transaction, and records it in the audit log. Before launch: rate-limit this endpoint and
-- confirm the person's phone or email with a one-time sign-in link.
CREATE FUNCTION kp_accept_invite(p_hash text, p_name text)
RETURNS TABLE (user_id uuid, clinic_id text, patient_first_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  inv support_invites%ROWTYPE;
  new_user uuid;
BEGIN
  SELECT * INTO inv FROM support_invites i WHERE i.code_hash = p_hash FOR UPDATE;
  IF NOT FOUND OR inv.accepted_at IS NOT NULL OR inv.canceled_at IS NOT NULL OR inv.expires_at < now() THEN
    RAISE EXCEPTION 'invite_invalid';
  END IF;
  IF char_length(trim(p_name)) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'name_invalid';
  END IF;
  -- The contact (phone or email) is the person's sign-in identifier.
  IF EXISTS (SELECT 1 FROM app_users u WHERE u.clinic_id = inv.clinic_id AND u.email = lower(inv.contact)) THEN
    RAISE EXCEPTION 'already_connected';
  END IF;
  INSERT INTO app_users (clinic_id, role, display_name, email) VALUES (inv.clinic_id, 'partner', trim(p_name), lower(inv.contact))
    RETURNING id INTO new_user;
  INSERT INTO partner_grants (clinic_id, patient_id, partner_user_id, sections, relationship)
    VALUES (inv.clinic_id, inv.patient_id, new_user, inv.sections, inv.relationship);
  UPDATE support_invites SET accepted_at = now(), accepted_user_id = new_user WHERE id = inv.id;
  INSERT INTO audit_events (clinic_id, actor_user_id, action, patient_id, detail)
    VALUES (inv.clinic_id, new_user, 'support.accepted_invite', inv.patient_id, jsonb_build_object('inviteId', inv.id, 'relationship', inv.relationship));
  RETURN QUERY SELECT new_user, inv.clinic_id, p.first_name FROM patients p WHERE p.id = inv.patient_id;
END $$;
REVOKE EXECUTE ON FUNCTION kp_accept_invite(text, text) FROM PUBLIC, kp_app;

GRANT SELECT, INSERT, UPDATE ON support_invites TO kp_app;
GRANT EXECUTE ON FUNCTION kp_partner_names(uuid) TO kp_app;

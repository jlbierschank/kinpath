-- Graduation to the OB-GYN, the shareable IVF pregnancy summary, the keepsake, and thank-you notes.

ALTER TABLE cycles ADD COLUMN graduated_on date;
ALTER TABLE cycles ADD COLUMN ob_name text CHECK (char_length(ob_name) <= 120);

-- The patient decides when her support people learn her result.
ALTER TABLE wait_prefs ADD COLUMN told_support boolean NOT NULL DEFAULT false;

-- What a support person may know about the outcome: nothing until the patient shares the news.
CREATE FUNCTION kp_shared_news(p_patient uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN NOT kp_can_view(p_patient, 'schedule') THEN NULL
    WHEN NOT coalesce((SELECT told_support FROM wait_prefs WHERE patient_id = p_patient), false) THEN NULL
    WHEN (SELECT graduated_on FROM cycles WHERE patient_id = p_patient ORDER BY started_on DESC LIMIT 1) IS NOT NULL THEN 'graduated'
    ELSE (SELECT outcome FROM pregnancy_tests WHERE patient_id = p_patient AND released_at IS NOT NULL ORDER BY scheduled_at DESC LIMIT 1)
  END
$$;

-- What she keeps, and what she chose to leave out.
CREATE TABLE keepsakes (
  patient_id uuid PRIMARY KEY REFERENCES patients(id),
  clinic_id text NOT NULL REFERENCES clinics(id),
  hidden text[] NOT NULL DEFAULT '{}',
  saved_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE keepsakes ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_keepsake_read ON keepsakes FOR SELECT USING (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id));
CREATE POLICY own_keepsake_add ON keepsakes FOR INSERT WITH CHECK (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id));
CREATE POLICY own_keepsake_change ON keepsakes FOR UPDATE USING (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id));
GRANT SELECT, INSERT, UPDATE ON keepsakes TO kp_app;

-- Thank-you notes to the care team. Staff read them; the patient writes them.
CREATE TABLE thank_you_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id text NOT NULL REFERENCES clinics(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  from_name text NOT NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE thank_you_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_read_thanks ON thank_you_notes FOR SELECT USING (clinic_id = kp_clinic() AND kp_is_clinician());
CREATE POLICY patient_thanks ON thank_you_notes FOR INSERT WITH CHECK (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id));
GRANT SELECT, INSERT ON thank_you_notes TO kp_app;

-- A secure, expiring, revocable link to the IVF pregnancy summary, for the patient's OB-GYN.
-- Only a hash of the link's token is stored. Every view is written to the audit log.
CREATE TABLE summary_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id text NOT NULL REFERENCES clinics(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  created_by uuid NOT NULL REFERENCES app_users(id),
  recipient text NOT NULL CHECK (char_length(recipient) BETWEEN 1 AND 120),
  include_results boolean NOT NULL,
  include_meds boolean NOT NULL,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  revoked_at timestamptz,
  views int NOT NULL DEFAULT 0,
  last_viewed_at timestamptz
);
ALTER TABLE summary_shares ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_shares_read ON summary_shares FOR SELECT USING (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id));
CREATE POLICY own_shares_add ON summary_shares FOR INSERT WITH CHECK (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id) AND created_by = kp_user());
CREATE POLICY own_shares_revoke ON summary_shares FOR UPDATE
  USING (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id))
  WITH CHECK (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id));
CREATE FUNCTION kp_share_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'kp_app' AND (
       NEW.token_hash IS DISTINCT FROM OLD.token_hash OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR NEW.include_results IS DISTINCT FROM OLD.include_results OR NEW.include_meds IS DISTINCT FROM OLD.include_meds
    OR NEW.patient_id IS DISTINCT FROM OLD.patient_id OR NEW.recipient IS DISTINCT FROM OLD.recipient
    OR NEW.views IS DISTINCT FROM OLD.views) THEN
    RAISE EXCEPTION 'a shared link can only be stopped';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER shares_guard BEFORE UPDATE ON summary_shares FOR EACH ROW EXECUTE FUNCTION kp_share_guard();
GRANT SELECT, INSERT, UPDATE ON summary_shares TO kp_app;

-- Opening a summary link. Runs without a signed-in user, so it lives in one narrow function:
-- it checks the token, builds the summary from exactly what the patient chose to include,
-- counts the view and writes it to the audit log.
CREATE FUNCTION kp_open_summary(p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s summary_shares%ROWTYPE;
  pat patients%ROWTYPE;
  cyc cycles%ROWTYPE;
  out jsonb;
BEGIN
  SELECT * INTO s FROM summary_shares WHERE token_hash = p_hash FOR UPDATE;
  IF NOT FOUND OR s.revoked_at IS NOT NULL OR s.expires_at < now() THEN
    RETURN NULL;
  END IF;
  SELECT * INTO pat FROM patients WHERE id = s.patient_id;
  SELECT * INTO cyc FROM cycles WHERE patient_id = s.patient_id ORDER BY started_on DESC LIMIT 1;
  out := jsonb_build_object(
    'patient', pat.first_name || ' ' || pat.last_name,
    'clinic', (SELECT name FROM clinics WHERE id = s.clinic_id),
    'recipient', s.recipient,
    'expiresAt', s.expires_at,
    'cycle', jsonb_build_object('kind', cyc.kind, 'startedOn', cyc.started_on, 'transferOn', cyc.transfer_on, 'graduatedOn', cyc.graduated_on, 'ob', cyc.ob_name),
    'tests', CASE WHEN s.include_results THEN coalesce((
        SELECT jsonb_agg(jsonb_build_object('at', least(t.scheduled_at, t.released_at), 'hcg', t.hcg, 'outcome', t.outcome) ORDER BY t.scheduled_at)
        FROM pregnancy_tests t WHERE t.patient_id = s.patient_id AND t.released_at IS NOT NULL), '[]'::jsonb) END,
    'labs', CASE WHEN s.include_results THEN coalesce((
        SELECT jsonb_agg(jsonb_build_object('analyte', l.analyte, 'value', l.value, 'unit', l.unit, 'stimDay', l.stim_day, 'at', l.collected_at) ORDER BY l.collected_at)
        FROM lab_results l WHERE l.patient_id = s.patient_id), '[]'::jsonb) END,
    'meds', CASE WHEN s.include_meds THEN coalesce((
        SELECT jsonb_agg(jsonb_build_object('medication', m.medication, 'dose', m.dose,
                 'taken', (SELECT count(*) FROM dose_logs d WHERE d.med_order_id = m.id AND d.taken_at IS NOT NULL)) ORDER BY m.medication)
        FROM med_orders m WHERE m.patient_id = s.patient_id), '[]'::jsonb) END
  );
  UPDATE summary_shares SET views = views + 1, last_viewed_at = now() WHERE id = s.id;
  INSERT INTO audit_events (clinic_id, actor_user_id, action, patient_id, detail)
    VALUES (s.clinic_id, s.created_by, 'summary.viewed_by_link', s.patient_id, jsonb_build_object('shareId', s.id, 'recipient', s.recipient));
  RETURN out;
END $$;
REVOKE EXECUTE ON FUNCTION kp_open_summary(text) FROM PUBLIC, kp_app;
GRANT EXECUTE ON FUNCTION kp_shared_news(uuid) TO kp_app;

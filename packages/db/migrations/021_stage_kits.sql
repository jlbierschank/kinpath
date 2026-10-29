-- Stage kits for people on their own: what she ticks off in the first-consult kit, her test
-- calendar, and her move from the fertility clinic to an OB. Validated in code (mergeKit) before it's saved.
ALTER TABLE personal_profiles ADD COLUMN kit jsonb NOT NULL DEFAULT '{}'::jsonb;

-- The summary she shares with her OB. 'clinic' links come from clinic mode (graduation);
-- 'personal' links come from her own record, with every item labeled by who entered it.
ALTER TABLE summary_shares ADD COLUMN kind text NOT NULL DEFAULT 'clinic' CHECK (kind IN ('clinic','personal'));

-- Opening a personal summary link. Same rules as kp_open_summary: no sign-in, the token is the key,
-- only what she chose to include, every view counted and written to the audit log.
CREATE FUNCTION kp_open_personal_summary(p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s summary_shares%ROWTYPE;
  pat patients%ROWTYPE;
  prof personal_profiles%ROWTYPE;
  out jsonb;
BEGIN
  SELECT * INTO s FROM summary_shares WHERE token_hash = p_hash AND kind = 'personal' FOR UPDATE;
  IF NOT FOUND OR s.revoked_at IS NOT NULL OR s.expires_at < now() THEN
    RETURN NULL;
  END IF;
  SELECT * INTO pat FROM patients WHERE id = s.patient_id;
  SELECT * INTO prof FROM personal_profiles WHERE patient_id = s.patient_id;
  out := jsonb_build_object(
    'patient', pat.first_name || ' ' || pat.last_name,
    'clinic', prof.clinic_name,
    'recipient', s.recipient,
    'createdAt', s.created_at,
    'expiresAt', s.expires_at,
    'ob', prof.kit -> 'ob',
    'results', CASE WHEN s.include_results THEN coalesce((
        SELECT jsonb_agg(jsonb_build_object('test', coalesce(l.test_name, l.analyte), 'analyte', l.analyte, 'value', l.value, 'unit', l.unit, 'on', (l.collected_at AT TIME ZONE c.timezone)::date,
                 'by', CASE WHEN l.source <> 'patient_upload' THEN 'clinic' WHEN l.capture_id IS NOT NULL THEN 'read' ELSE 'you' END) ORDER BY l.collected_at)
        FROM lab_results l JOIN clinics c ON c.id = l.clinic_id WHERE l.patient_id = s.patient_id), '[]'::jsonb) END,
    'meds', CASE WHEN s.include_meds THEN coalesce((
        SELECT jsonb_agg(jsonb_build_object('medication', m.medication, 'dose', m.dose, 'time', to_char(m.time_of_day, 'HH24:MI'), 'startsOn', m.starts_on, 'endsOn', m.ends_on, 'active', m.status = 'active',
                 'by', CASE WHEN m.source <> 'patient' THEN 'clinic' WHEN m.capture_id IS NOT NULL THEN 'read' ELSE 'you' END) ORDER BY m.status, m.medication, m.time_of_day)
        FROM med_orders m WHERE m.patient_id = s.patient_id AND m.status <> 'pending_review'), '[]'::jsonb) END,
    'appointments', coalesce((
        SELECT jsonb_agg(jsonb_build_object('title', a.title, 'at', a.starts_at, 'by', CASE WHEN a.source = 'patient' THEN 'you' ELSE 'clinic' END) ORDER BY a.starts_at)
        FROM appointments a WHERE a.patient_id = s.patient_id AND a.status = 'booked' AND a.starts_at > now() - interval '120 days'), '[]'::jsonb)
  );
  UPDATE summary_shares SET views = views + 1, last_viewed_at = now() WHERE id = s.id;
  INSERT INTO audit_events (clinic_id, actor_user_id, action, patient_id, detail)
    VALUES (s.clinic_id, s.created_by, 'summary.viewed_by_link', s.patient_id, jsonb_build_object('shareId', s.id, 'recipient', s.recipient));
  RETURN out;
END $$;
REVOKE EXECUTE ON FUNCTION kp_open_personal_summary(text) FROM PUBLIC, kp_app;

-- A link's kind can't change after it's made.
CREATE OR REPLACE FUNCTION kp_share_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'kp_app' AND (
       NEW.token_hash IS DISTINCT FROM OLD.token_hash OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR NEW.include_results IS DISTINCT FROM OLD.include_results OR NEW.include_meds IS DISTINCT FROM OLD.include_meds
    OR NEW.patient_id IS DISTINCT FROM OLD.patient_id OR NEW.recipient IS DISTINCT FROM OLD.recipient
    OR NEW.views IS DISTINCT FROM OLD.views OR NEW.kind IS DISTINCT FROM OLD.kind) THEN
    RAISE EXCEPTION 'a shared link can only be stopped';
  END IF;
  RETURN NEW;
END $$;

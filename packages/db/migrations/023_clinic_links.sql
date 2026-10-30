-- Connecting a patient's own Pumpkin space to her clinic when the clinic is on Pumpkin.
-- She asks, choosing what to share; a nurse confirms who she is (matching her to a chart, or not
-- yet); then the clinic can see only the parts she chose, read live from her space, until she stops.
-- Her record stays hers: nothing is copied into the clinic, and stopping ends access at once.

CREATE TABLE clinic_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id text NOT NULL REFERENCES clinics(id),          -- her personal space
  patient_id uuid NOT NULL REFERENCES patients(id),       -- her patient row in that space
  clinic_id text NOT NULL REFERENCES clinics(id),         -- the clinic she's connecting to
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','active','declined','stopped')),
  -- What she chose to share. "about" is how to address her and how she wants news; "background" is health history.
  share_about boolean NOT NULL DEFAULT false,
  share_background boolean NOT NULL DEFAULT false,
  share_meds boolean NOT NULL DEFAULT false,
  share_results boolean NOT NULL DEFAULT false,
  share_visits boolean NOT NULL DEFAULT false,
  share_questions boolean NOT NULL DEFAULT false,
  -- So the clinic can tell who she is: the name and contact she signed up with (shown only to that clinic).
  legal_name text NOT NULL CHECK (char_length(legal_name) <= 120),
  contact text CHECK (char_length(contact) <= 120),
  clinic_patient_id uuid REFERENCES patients(id),          -- the chart a nurse matched her to, if any
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid REFERENCES app_users(id),
  decided_by_name text,
  stopped_at timestamptz
);
CREATE UNIQUE INDEX clinic_links_live ON clinic_links (patient_id, clinic_id) WHERE status IN ('requested','active');
ALTER TABLE clinic_links ENABLE ROW LEVEL SECURITY;
-- She sees her own links; the clinic's nurses, physicians and admins see links to their clinic. All changes go through the functions below.
CREATE POLICY link_read ON clinic_links FOR SELECT USING (
  (space_id = kp_clinic() AND kp_owns(patient_id)) OR (clinic_id = kp_clinic() AND kp_role() IN ('nurse','physician','clinic_admin')));
GRANT SELECT ON clinic_links TO kp_app;

-- Clinics she can connect to: names only.
CREATE FUNCTION kp_joinable_clinics(p_query text) RETURNS TABLE (id text, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.name FROM clinics c
   WHERE c.kind = 'clinic' AND kp_is_personal() AND char_length(trim(p_query)) >= 2
     AND c.name ILIKE '%' || replace(replace(trim(p_query), '%', ''), '_', '') || '%'
   ORDER BY c.name LIMIT 8
$$;

CREATE FUNCTION kp_link_request(p_clinic text, p_share jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pid uuid; nm text; ct text; out uuid;
BEGIN
  IF NOT kp_is_personal() OR kp_role() <> 'patient' THEN RAISE EXCEPTION 'only she can connect her space'; END IF;
  SELECT p.id, p.first_name || ' ' || p.last_name INTO pid, nm FROM patients p WHERE p.user_id = kp_user() AND p.clinic_id = kp_clinic();
  IF pid IS NULL THEN RAISE EXCEPTION 'no patient'; END IF;
  IF NOT EXISTS (SELECT 1 FROM clinics WHERE id = p_clinic AND kind = 'clinic') THEN RAISE EXCEPTION 'not a clinic on Pumpkin'; END IF;
  SELECT coalesce(s.phone, u.email) INTO ct FROM app_users u LEFT JOIN user_settings s ON s.user_id = u.id WHERE u.id = kp_user();
  INSERT INTO clinic_links (space_id, patient_id, clinic_id, legal_name, contact, share_about, share_background, share_meds, share_results, share_visits, share_questions)
  VALUES (kp_clinic(), pid, p_clinic, nm, ct, coalesce((p_share->>'about')::boolean, false), coalesce((p_share->>'background')::boolean, false),
          coalesce((p_share->>'meds')::boolean, false), coalesce((p_share->>'results')::boolean, false), coalesce((p_share->>'visits')::boolean, false),
          coalesce((p_share->>'questions')::boolean, false))
  RETURNING id INTO out;
  INSERT INTO audit_events (clinic_id, actor_user_id, action, patient_id, detail) VALUES (kp_clinic(), kp_user(), 'patient.requested_clinic_link', pid, jsonb_build_object('linkId', out, 'clinicId', p_clinic, 'share', p_share));
  RETURN out;
END $$;

-- She changes what's shared, or stops. Stopping ends the clinic's access right away.
CREATE FUNCTION kp_link_update(p_link uuid, p_share jsonb, p_stop boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l clinic_links%ROWTYPE;
BEGIN
  SELECT * INTO l FROM clinic_links WHERE id = p_link FOR UPDATE;
  IF NOT FOUND OR l.space_id <> kp_clinic() OR NOT kp_owns(l.patient_id) THEN RAISE EXCEPTION 'not your link'; END IF;
  IF l.status NOT IN ('requested','active') THEN RAISE EXCEPTION 'link already ended'; END IF;
  IF p_stop THEN
    UPDATE clinic_links SET status = 'stopped', stopped_at = now() WHERE id = p_link;
  ELSE
    UPDATE clinic_links SET share_about = coalesce((p_share->>'about')::boolean, share_about), share_background = coalesce((p_share->>'background')::boolean, share_background),
      share_meds = coalesce((p_share->>'meds')::boolean, share_meds), share_results = coalesce((p_share->>'results')::boolean, share_results),
      share_visits = coalesce((p_share->>'visits')::boolean, share_visits), share_questions = coalesce((p_share->>'questions')::boolean, share_questions)
     WHERE id = p_link;
  END IF;
  INSERT INTO audit_events (clinic_id, actor_user_id, action, patient_id, detail) VALUES (kp_clinic(), kp_user(), CASE WHEN p_stop THEN 'patient.stopped_clinic_link' ELSE 'patient.changed_clinic_link' END, l.patient_id, jsonb_build_object('linkId', p_link, 'share', p_share));
END $$;

-- A nurse or physician confirms who she is (optionally matching her to a chart) or declines.
CREATE FUNCTION kp_link_decide(p_link uuid, p_accept boolean, p_chart uuid, p_name text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l clinic_links%ROWTYPE;
BEGIN
  IF kp_role() NOT IN ('nurse','physician') THEN RAISE EXCEPTION 'only nurses and physicians can do this'; END IF;
  SELECT * INTO l FROM clinic_links WHERE id = p_link FOR UPDATE;
  IF NOT FOUND OR l.clinic_id <> kp_clinic() THEN RAISE EXCEPTION 'not your clinic'; END IF;
  IF l.status <> 'requested' THEN RAISE EXCEPTION 'already decided'; END IF;
  IF p_chart IS NOT NULL AND NOT EXISTS (SELECT 1 FROM patients WHERE id = p_chart AND clinic_id = kp_clinic()) THEN RAISE EXCEPTION 'not your patient'; END IF;
  IF p_chart IS NOT NULL AND EXISTS (SELECT 1 FROM clinic_links WHERE clinic_patient_id = p_chart AND status = 'active') THEN RAISE EXCEPTION 'chart already connected'; END IF;
  UPDATE clinic_links SET status = CASE WHEN p_accept THEN 'active' ELSE 'declined' END, clinic_patient_id = CASE WHEN p_accept THEN p_chart END,
         decided_at = now(), decided_by = kp_user(), decided_by_name = left(p_name, 120)
   WHERE id = p_link;
  INSERT INTO audit_events (clinic_id, actor_user_id, action, patient_id, detail)
    VALUES (kp_clinic(), kp_user(), CASE WHEN p_accept THEN 'staff.accepted_clinic_link' ELSE 'staff.declined_clinic_link' END, p_chart, jsonb_build_object('linkId', p_link));
END $$;

-- A nurse or physician matches an accepted link to a chart later (for example after adding her as a patient).
CREATE FUNCTION kp_link_match(p_link uuid, p_chart uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l clinic_links%ROWTYPE;
BEGIN
  IF kp_role() NOT IN ('nurse','physician') THEN RAISE EXCEPTION 'only nurses and physicians can do this'; END IF;
  SELECT * INTO l FROM clinic_links WHERE id = p_link FOR UPDATE;
  IF NOT FOUND OR l.clinic_id <> kp_clinic() OR l.status <> 'active' THEN RAISE EXCEPTION 'no active link'; END IF;
  IF NOT EXISTS (SELECT 1 FROM patients WHERE id = p_chart AND clinic_id = kp_clinic()) THEN RAISE EXCEPTION 'not your patient'; END IF;
  IF EXISTS (SELECT 1 FROM clinic_links WHERE clinic_patient_id = p_chart AND status = 'active' AND id <> p_link) THEN RAISE EXCEPTION 'chart already connected'; END IF;
  UPDATE clinic_links SET clinic_patient_id = p_chart WHERE id = p_link;
  INSERT INTO audit_events (clinic_id, actor_user_id, action, patient_id, detail) VALUES (kp_clinic(), kp_user(), 'staff.matched_clinic_link', p_chart, jsonb_build_object('linkId', p_link));
END $$;

-- What the clinic sees: only the parts she shares, read live from her space, and every look is logged.
CREATE FUNCTION kp_link_snapshot(p_link uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l clinic_links%ROWTYPE; a patient_about%ROWTYPE; prof personal_profiles%ROWTYPE; out jsonb;
BEGIN
  IF kp_role() NOT IN ('nurse','physician') THEN RETURN NULL; END IF;
  SELECT * INTO l FROM clinic_links WHERE id = p_link;
  IF NOT FOUND OR l.clinic_id <> kp_clinic() OR l.status <> 'active' THEN RETURN NULL; END IF;
  SELECT * INTO a FROM patient_about WHERE patient_id = l.patient_id;
  SELECT * INTO prof FROM personal_profiles WHERE patient_id = l.patient_id;
  out := jsonb_build_object(
    'linkId', l.id, 'legalName', l.legal_name, 'contact', l.contact, 'since', l.decided_at,
    'stage', prof.stage,
    'about', CASE WHEN l.share_about THEN jsonb_build_object(
        'preferredName', a.preferred_name, 'pronunciation', a.pronunciation, 'pronouns', a.pronouns,
        'familyPath', CASE WHEN a.sensitive_consent_at IS NOT NULL THEN to_jsonb(a.family_path) END,
        'partnerName', CASE WHEN a.sensitive_consent_at IS NOT NULL THEN a.partner_name END,
        'partnerPronouns', CASE WHEN a.sensitive_consent_at IS NOT NULL THEN a.partner_pronouns END,
        'partnerTitle', CASE WHEN a.sensitive_consent_at IS NOT NULL THEN a.partner_title END,
        'tone', a.tone, 'revealResults', a.reveal_results) END,
    'background', CASE WHEN l.share_background AND a.sensitive_consent_at IS NOT NULL THEN jsonb_build_object(
        'conditions', to_jsonb(a.conditions), 'conditionsOther', a.conditions_other, 'pastCycles', a.past_cycles, 'pastLoss', a.past_loss, 'allergies', a.allergies) END,
    'meds', CASE WHEN l.share_meds THEN coalesce((SELECT jsonb_agg(jsonb_build_object('medication', m.medication, 'dose', m.dose, 'time', to_char(m.time_of_day, 'HH24:MI'), 'startsOn', m.starts_on, 'endsOn', m.ends_on) ORDER BY m.medication, m.time_of_day)
        FROM med_orders m WHERE m.patient_id = l.patient_id AND m.status = 'active'), '[]'::jsonb) END,
    'results', CASE WHEN l.share_results THEN coalesce((SELECT jsonb_agg(jsonb_build_object('test', coalesce(r.test_name, r.analyte), 'value', r.value, 'unit', r.unit, 'on', r.collected_at, 'refText', r.ref_text, 'refLow', r.ref_low, 'refHigh', r.ref_high) ORDER BY r.collected_at DESC)
        FROM (SELECT * FROM lab_results WHERE patient_id = l.patient_id ORDER BY collected_at DESC LIMIT 30) r), '[]'::jsonb) END,
    'visits', CASE WHEN l.share_visits THEN coalesce((SELECT jsonb_agg(jsonb_build_object('title', v.title, 'at', v.starts_at, 'location', v.location) ORDER BY v.starts_at)
        FROM appointments v WHERE v.patient_id = l.patient_id AND v.status = 'booked' AND v.starts_at > now() - interval '1 day'), '[]'::jsonb) END,
    'questions', CASE WHEN l.share_questions THEN coalesce((SELECT jsonb_agg(q.question ORDER BY q.created_at)
        FROM visit_questions q WHERE q.patient_id = l.patient_id AND q.asked_at IS NULL), '[]'::jsonb) END
  );
  INSERT INTO audit_events (clinic_id, actor_user_id, action, patient_id, detail) VALUES (kp_clinic(), kp_user(), 'staff.viewed_linked_space', l.clinic_patient_id, jsonb_build_object('linkId', l.id));
  RETURN out;
END $$;

-- A clinic's name (clinic names aren't private), so her side can say who she's connected to.
CREATE FUNCTION kp_clinic_name(p_id text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT name FROM clinics WHERE id = p_id AND kind = 'clinic' $$;

-- For lists and the queue: just how to address her, if she shares it. Not logged per row (no health details).
CREATE FUNCTION kp_link_names(p_link uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('preferredName', a.preferred_name, 'pronouns', a.pronouns)
    FROM clinic_links l LEFT JOIN patient_about a ON a.patient_id = l.patient_id
   WHERE l.id = p_link AND l.status = 'active' AND l.share_about AND l.clinic_id = kp_clinic() AND kp_role() IN ('nurse','physician')
$$;

REVOKE EXECUTE ON FUNCTION kp_clinic_name(text), kp_link_names(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kp_clinic_name(text), kp_link_names(uuid) TO kp_app;
REVOKE EXECUTE ON FUNCTION kp_joinable_clinics(text), kp_link_request(text, jsonb), kp_link_update(uuid, jsonb, boolean), kp_link_decide(uuid, boolean, uuid, text), kp_link_match(uuid, uuid), kp_link_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kp_joinable_clinics(text), kp_link_request(text, jsonb), kp_link_update(uuid, jsonb, boolean), kp_link_decide(uuid, boolean, uuid, text), kp_link_match(uuid, uuid), kp_link_snapshot(uuid) TO kp_app;

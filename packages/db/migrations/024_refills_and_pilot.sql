-- Refill requests that land with the nurse, from a clinic's patients and from patients who connected
-- their own Pumpkin. They arrive in the queue like any message (and are still checked for urgent words).
ALTER TABLE handoffs DROP CONSTRAINT IF EXISTS handoffs_kind_check;
ALTER TABLE handoffs ADD CONSTRAINT handoffs_kind_check CHECK (kind IN ('missed_dose','question','urgent_symptom','result_review','crisis','refill_request'));
-- Where a message came from: the clinic's app, or her own Pumpkin through a connection.
ALTER TABLE handoffs ADD COLUMN via_link uuid REFERENCES clinic_links(id) ON DELETE SET NULL;

-- A connected patient asks her clinic for a refill from her own Pumpkin. Only with an active connection
-- that shares medications and is matched to a chart; it lands on that chart in the clinic's queue.
CREATE FUNCTION kp_link_refill(p_medication text, p_message text, p_triage jsonb, p_kind text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l clinic_links%ROWTYPE; out uuid;
BEGIN
  IF NOT kp_is_personal() OR kp_role() <> 'patient' THEN RAISE EXCEPTION 'only she can ask'; END IF;
  IF p_kind NOT IN ('refill_request','urgent_symptom','crisis') THEN RAISE EXCEPTION 'bad kind'; END IF;
  SELECT l2.* INTO l FROM clinic_links l2 JOIN patients p ON p.id = l2.patient_id
   WHERE l2.space_id = kp_clinic() AND p.user_id = kp_user() AND l2.status = 'active' AND l2.share_meds AND l2.clinic_patient_id IS NOT NULL
   ORDER BY l2.decided_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'no connected clinic'; END IF;
  IF char_length(p_message) > 1000 OR char_length(p_medication) > 120 THEN RAISE EXCEPTION 'too long'; END IF;
  INSERT INTO handoffs (clinic_id, patient_id, kind, patient_message, triage, via_link)
  VALUES (l.clinic_id, l.clinic_patient_id, p_kind, p_message, p_triage, l.id) RETURNING id INTO out;
  INSERT INTO audit_events (clinic_id, actor_user_id, action, patient_id, detail) VALUES (kp_clinic(), kp_user(), 'patient.requested_refill_from_space', l.patient_id, jsonb_build_object('linkId', l.id, 'handoffId', out, 'medication', p_medication));
  RETURN out;
END $$;
REVOKE EXECUTE ON FUNCTION kp_link_refill(text, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kp_link_refill(text, text, jsonb, text) TO kp_app;

-- What happened to the refills she asked for from her own Pumpkin, so she isn't left wondering.
CREATE FUNCTION kp_link_my_refills() RETURNS TABLE (id uuid, clinic_name text, message text, status text, outcome text, asked_at timestamptz, handled_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT h.id, c.name, h.patient_message, h.status, h.sent_text, h.created_at, h.sent_at
    FROM handoffs h JOIN clinic_links l ON l.id = h.via_link JOIN patients p ON p.id = l.patient_id JOIN clinics c ON c.id = l.clinic_id
   WHERE kp_is_personal() AND kp_role() = 'patient' AND l.space_id = kp_clinic() AND p.user_id = kp_user()
     AND h.created_at > now() - interval '60 days'
   ORDER BY h.created_at DESC LIMIT 10
$$;
REVOKE EXECUTE ON FUNCTION kp_link_my_refills() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kp_link_my_refills() TO kp_app;

-- Pilot numbers for the clinic: counts only, never names or messages. Nurses, physicians and clinic
-- admins can see them. Calls are the ones logged in Pumpkin; calls taken outside it aren't counted.
CREATE FUNCTION kp_pilot_metrics(p_days int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE since timestamptz := now() - make_interval(days => greatest(1, least(p_days, 365))); out jsonb;
BEGIN
  IF kp_role() NOT IN ('nurse','physician','clinic_admin') OR NOT EXISTS (SELECT 1 FROM clinics WHERE id = kp_clinic() AND kind = 'clinic') THEN
    RAISE EXCEPTION 'clinic staff only';
  END IF;
  WITH h AS (SELECT * FROM handoffs WHERE clinic_id = kp_clinic() AND created_at >= since AND kind <> 'result_review'),
  cyc AS (SELECT * FROM cycles WHERE clinic_id = kp_clinic() AND (started_on >= since::date OR stage <> 'graduated')),
  consults AS (
    SELECT a.patient_id, min(a.starts_at) AS at FROM appointments a
     WHERE a.clinic_id = kp_clinic() AND a.kind = 'consult' AND a.status = 'booked' AND a.starts_at >= since AND a.starts_at <= now()
     GROUP BY a.patient_id),
  doses AS (SELECT * FROM dose_logs WHERE clinic_id = kp_clinic() AND canceled_at IS NULL AND scheduled_for >= since AND scheduled_for <= now())
  SELECT jsonb_build_object(
    'days', extract(day FROM now() - since)::int,
    'activeCycles', (SELECT count(*) FROM cyc),
    'patientsUsing', (SELECT count(DISTINCT patient_id) FROM (SELECT patient_id FROM h UNION SELECT patient_id FROM doses WHERE taken_at IS NOT NULL OR reported_missed_at IS NOT NULL) x),
    'messages', (SELECT coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) FROM (SELECT kind, count(*) n FROM h GROUP BY kind) k),
    'medianReplyHours', (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM sent_at - created_at)) / 3600)::numeric, 1)
                           FROM h WHERE sent_at IS NOT NULL AND kind IN ('question','missed_dose')),
    'medianUrgentMinutes', (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM sent_at - created_at)) / 60)::numeric)
                           FROM h WHERE sent_at IS NOT NULL AND kind IN ('urgent_symptom','crisis')),
    'refills', (SELECT count(*) FROM h WHERE kind = 'refill_request'),
    'refillsFromOwnPumpkin', (SELECT count(*) FROM h WHERE kind = 'refill_request' AND via_link IS NOT NULL),
    'medianRefillHours', (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM sent_at - created_at)) / 3600)::numeric, 1)
                           FROM h WHERE sent_at IS NOT NULL AND kind = 'refill_request'),
    'callsLogged', (SELECT count(*) FROM h WHERE status = 'closed' AND kind IN ('urgent_symptom','crisis'))
                 + (SELECT count(*) FROM nurse_tasks WHERE clinic_id = kp_clinic() AND done_at >= since),
    'dosesDue', (SELECT count(*) FROM doses),
    'dosesLogged', (SELECT count(*) FROM doses WHERE taken_at IS NOT NULL),
    'consults', (SELECT count(*) FROM consults),
    'consultsToCycles', (SELECT count(*) FROM consults c WHERE EXISTS (SELECT 1 FROM cycles y WHERE y.patient_id = c.patient_id AND y.started_on >= c.at::date)),
    'connectedPatients', (SELECT count(*) FROM clinic_links WHERE clinic_id = kp_clinic() AND status = 'active')
  ) INTO out;
  INSERT INTO audit_events (clinic_id, actor_user_id, action, detail) VALUES (kp_clinic(), kp_user(), 'staff.viewed_pilot_metrics', jsonb_build_object('days', p_days));
  RETURN out;
END $$;
REVOKE EXECUTE ON FUNCTION kp_pilot_metrics(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kp_pilot_metrics(int) TO kp_app;

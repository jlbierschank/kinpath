-- The two-week wait and result day.
--
-- Safety rules this schema enforces:
-- 1. A pregnancy test result is invisible to the patient until a nurse or physician releases it.
--    Patients never read pregnancy_tests directly; they go through kp_pregnancy_test_view().
-- 2. Support people never see a result, even after release. The patient tells them herself.
-- 3. The outcome (positive / negative / needs a repeat) is a clinician's decision, entered by
--    hand. Kinpath never computes it from the hCG number.

-- Stimulation doses after a transfer are canceled, not deleted, so the record stays complete.
ALTER TABLE dose_logs ADD COLUMN canceled_at timestamptz;
ALTER TABLE cycles ADD COLUMN transfer_on date;

CREATE POLICY clinician_cycles ON cycles FOR UPDATE USING (clinic_id = kp_clinic() AND kp_is_clinician());
GRANT UPDATE ON cycles TO kp_app;

CREATE TABLE pregnancy_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id text NOT NULL REFERENCES clinics(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  cycle_id uuid NOT NULL REFERENCES cycles(id),
  scheduled_at timestamptz NOT NULL,
  hcg numeric,
  outcome text CHECK (outcome IN ('positive','negative','repeat')),
  nurse_note text CHECK (char_length(nurse_note) <= 1000),
  entered_by_name text,
  released_at timestamptz,
  released_by_name text,
  -- How the patient heard: 'phone' (the nurse called first) or 'app'.
  told_by text CHECK (told_by IN ('phone','app')),
  CHECK (released_at IS NULL OR (outcome IS NOT NULL AND nurse_note IS NOT NULL AND char_length(nurse_note) > 0))
);
ALTER TABLE pregnancy_tests ENABLE ROW LEVEL SECURITY;
CREATE POLICY clinician_tests ON pregnancy_tests FOR ALL
  USING (clinic_id = kp_clinic() AND kp_is_clinician())
  WITH CHECK (clinic_id = kp_clinic() AND kp_is_clinician());
GRANT SELECT, INSERT, UPDATE ON pregnancy_tests TO kp_app;

-- What a patient or support person may know about the latest test.
CREATE FUNCTION kp_pregnancy_test_view(p_patient uuid)
RETURNS TABLE (scheduled_at timestamptz, released boolean, outcome text, hcg numeric, nurse_note text, released_by_name text, released_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.scheduled_at,
         t.released_at IS NOT NULL,
         CASE WHEN kp_is_patient_self(p_patient) AND t.released_at IS NOT NULL THEN t.outcome END,
         CASE WHEN kp_is_patient_self(p_patient) AND t.released_at IS NOT NULL THEN t.hcg END,
         CASE WHEN kp_is_patient_self(p_patient) AND t.released_at IS NOT NULL THEN t.nurse_note END,
         CASE WHEN kp_is_patient_self(p_patient) AND t.released_at IS NOT NULL THEN t.released_by_name END,
         CASE WHEN kp_is_patient_self(p_patient) AND t.released_at IS NOT NULL THEN t.released_at END
  FROM pregnancy_tests t
  WHERE t.patient_id = p_patient AND t.clinic_id = kp_clinic()
    AND (kp_is_patient_self(p_patient) OR kp_can_view(p_patient, 'schedule'))
  ORDER BY t.scheduled_at DESC LIMIT 1
$$;

-- The patient's choices for the wait.
CREATE TABLE wait_prefs (
  patient_id uuid PRIMARY KEY REFERENCES patients(id),
  clinic_id text NOT NULL REFERENCES clinics(id),
  result_how text CHECK (result_how IN ('call','app','together')),
  hide_day_count boolean NOT NULL DEFAULT false,
  -- After a negative result the app goes quiet for 14 days unless she turns it off.
  quiet_off boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE wait_prefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_wait_read ON wait_prefs FOR SELECT USING (clinic_id = kp_clinic() AND (kp_is_patient_self(patient_id) OR kp_is_clinician()));
CREATE POLICY own_wait_add ON wait_prefs FOR INSERT WITH CHECK (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id));
CREATE POLICY own_wait_change ON wait_prefs FOR UPDATE USING (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id));
GRANT SELECT, INSERT, UPDATE ON wait_prefs TO kp_app;

-- A support person only learns whether she hid the day count (so they don't show it either).
CREATE FUNCTION kp_hide_day_count(p_patient uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT hide_day_count FROM wait_prefs w WHERE w.patient_id = p_patient AND w.clinic_id = kp_clinic()
                   AND (kp_is_patient_self(p_patient) OR kp_can_view(p_patient, 'schedule'))), false)
$$;

-- Daily "How are you today?"
CREATE TABLE wellbeing_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id text NOT NULL REFERENCES clinics(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  feeling text NOT NULL CHECK (feeling IN ('okay','anxious','struggling')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE wellbeing_checkins ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_checkins_read ON wellbeing_checkins FOR SELECT USING (clinic_id = kp_clinic() AND (kp_is_patient_self(patient_id) OR kp_is_clinician()));
CREATE POLICY own_checkins_add ON wellbeing_checkins FOR INSERT WITH CHECK (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id));
GRANT SELECT, INSERT ON wellbeing_checkins TO kp_app;

-- Internal nurse tasks (calls to make). Patients can ask for a call but can never read the list.
CREATE TABLE nurse_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id text NOT NULL REFERENCES clinics(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  kind text NOT NULL CHECK (kind IN ('wellbeing_call','result_call','negative_followup')),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz,
  done_by_name text,
  done_note text
);
ALTER TABLE nurse_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY clinician_tasks ON nurse_tasks FOR ALL
  USING (clinic_id = kp_clinic() AND kp_is_clinician())
  WITH CHECK (clinic_id = kp_clinic() AND kp_is_clinician());
CREATE POLICY patient_asks_call ON nurse_tasks FOR INSERT
  WITH CHECK (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id) AND kind = 'wellbeing_call' AND done_at IS NULL);
GRANT SELECT, INSERT, UPDATE ON nurse_tasks TO kp_app;
-- INSERT ... RETURNING needs SELECT; patients don't get it, so their inserts don't use RETURNING.

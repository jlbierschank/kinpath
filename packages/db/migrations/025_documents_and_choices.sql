-- Phase 4, December items: insurance statements read like other documents, every item keeps where it
-- was read from, and two choices that are off until she turns them on (research, and predictions).

-- Insurance coverage is now something Pumpkin can read from a statement.
ALTER TABLE capture_items DROP CONSTRAINT IF EXISTS capture_items_kind_check;
ALTER TABLE capture_items ADD CONSTRAINT capture_items_kind_check CHECK (kind IN ('medication','result','appointment','cost','question','coverage'));
-- Where each item was read from: {"page": 2, "quote": "Estradiol 412 pg/mL"}.
ALTER TABLE capture_items ADD COLUMN source jsonb;

-- Her own coverage, from her own statements, in the same table the clinic's counselors use.
ALTER TABLE finance_coverage DROP CONSTRAINT IF EXISTS finance_coverage_source_check;
ALTER TABLE finance_coverage ADD CONSTRAINT finance_coverage_source_check CHECK (source IN ('staff','records','patient'));
ALTER TABLE finance_coverage ADD COLUMN capture_id uuid REFERENCES captures(id) ON DELETE SET NULL;
ALTER TABLE finance_coverage ADD COLUMN as_of date;
CREATE POLICY own_coverage ON finance_coverage FOR ALL
  USING (clinic_id = kp_clinic() AND kp_is_personal() AND kp_is_patient_self(patient_id) AND source = 'patient')
  WITH CHECK (clinic_id = kp_clinic() AND kp_is_personal() AND kp_is_patient_self(patient_id) AND source = 'patient');

-- Her choices about her data. Both off by default; changing one is recorded with the time.
-- research: may her de-identified information be used in research (no research runs yet; she'd be asked again per study).
-- predictions: does she want to see estimates about what comes next, once Pumpkin offers them (none ship yet).
CREATE TABLE data_choices (
  patient_id uuid PRIMARY KEY REFERENCES patients(id) ON DELETE CASCADE,
  clinic_id text NOT NULL REFERENCES clinics(id),
  research boolean NOT NULL DEFAULT false,
  research_changed_at timestamptz,
  predictions boolean NOT NULL DEFAULT false,
  predictions_changed_at timestamptz
);
ALTER TABLE data_choices ENABLE ROW LEVEL SECURITY;
-- Only she sees or changes these. Not her clinic, not her support people.
CREATE POLICY own_choices ON data_choices FOR ALL USING (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id)) WITH CHECK (clinic_id = kp_clinic() AND kp_is_patient_self(patient_id));
GRANT SELECT, INSERT, UPDATE ON data_choices TO kp_app;

-- ---------- Sending her record (connecting layer, tier 1) ----------
-- She picks sections every time. Embryo details stay out unless she adds them. Links last 30 days
-- by default and can be stopped. Each opening and each download is recorded.
ALTER TABLE summary_shares ADD COLUMN sections text[] CHECK (sections <@ ARRAY['meds','results','visits','costs','coverage','pregnancy','embryo']::text[]);

CREATE OR REPLACE FUNCTION kp_share_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'kp_app' AND (
       NEW.token_hash IS DISTINCT FROM OLD.token_hash OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR NEW.include_results IS DISTINCT FROM OLD.include_results OR NEW.include_meds IS DISTINCT FROM OLD.include_meds
    OR NEW.sections IS DISTINCT FROM OLD.sections
    OR NEW.patient_id IS DISTINCT FROM OLD.patient_id OR NEW.recipient IS DISTINCT FROM OLD.recipient
    OR NEW.views IS DISTINCT FROM OLD.views OR NEW.kind IS DISTINCT FROM OLD.kind) THEN
    RAISE EXCEPTION 'a shared link can only be stopped';
  END IF;
  RETURN NEW;
END $$;

DROP FUNCTION kp_open_personal_summary(text);
CREATE FUNCTION kp_open_personal_summary(p_hash text, p_how text DEFAULT 'view') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s summary_shares%ROWTYPE;
  pat patients%ROWTYPE;
  prof personal_profiles%ROWTYPE;
  sec text[];
  out jsonb;
BEGIN
  SELECT * INTO s FROM summary_shares WHERE token_hash = p_hash AND kind = 'personal' FOR UPDATE;
  IF NOT FOUND OR s.revoked_at IS NOT NULL OR s.expires_at < now() THEN
    RETURN NULL;
  END IF;
  -- Links made before sections existed: visits and pregnancy always, results and meds as chosen.
  sec := coalesce(s.sections, ARRAY['visits','pregnancy']
    || CASE WHEN s.include_results THEN ARRAY['results'] ELSE ARRAY[]::text[] END
    || CASE WHEN s.include_meds THEN ARRAY['meds'] ELSE ARRAY[]::text[] END);
  SELECT * INTO pat FROM patients WHERE id = s.patient_id;
  SELECT * INTO prof FROM personal_profiles WHERE patient_id = s.patient_id;
  out := jsonb_build_object(
    'id', s.id,
    'patient', pat.first_name || ' ' || pat.last_name,
    'clinic', prof.clinic_name,
    'recipient', s.recipient,
    'createdAt', s.created_at,
    'expiresAt', s.expires_at,
    'sections', to_jsonb(sec),
    -- The due date needs how she conceived; the app shows that detail only if 'embryo' is chosen.
    'ob', CASE WHEN 'pregnancy' = ANY(sec) THEN prof.kit -> 'ob' END,
    'results', CASE WHEN 'results' = ANY(sec) THEN coalesce((
        SELECT jsonb_agg(jsonb_build_object('test', coalesce(l.test_name, l.analyte), 'analyte', l.analyte, 'loinc', l.loinc, 'value', l.value, 'unit', l.unit, 'on', (l.collected_at AT TIME ZONE c.timezone)::date,
                 'by', CASE WHEN l.source <> 'patient_upload' THEN 'clinic' WHEN l.capture_id IS NOT NULL THEN 'read' ELSE 'you' END) ORDER BY l.collected_at)
        FROM lab_results l JOIN clinics c ON c.id = l.clinic_id WHERE l.patient_id = s.patient_id), '[]'::jsonb) END,
    'meds', CASE WHEN 'meds' = ANY(sec) THEN coalesce((
        SELECT jsonb_agg(jsonb_build_object('medication', m.medication, 'rxnorm', m.rxnorm, 'dose', m.dose, 'time', to_char(m.time_of_day, 'HH24:MI'), 'startsOn', m.starts_on, 'endsOn', m.ends_on, 'active', m.status = 'active',
                 'by', CASE WHEN m.source <> 'patient' THEN 'clinic' WHEN m.capture_id IS NOT NULL THEN 'read' ELSE 'you' END) ORDER BY m.status, m.medication, m.time_of_day)
        FROM med_orders m WHERE m.patient_id = s.patient_id AND m.status <> 'pending_review'), '[]'::jsonb) END,
    'appointments', CASE WHEN 'visits' = ANY(sec) THEN coalesce((
        SELECT jsonb_agg(jsonb_build_object('title', a.title, 'at', a.starts_at, 'location', a.location, 'by', CASE WHEN a.source = 'patient' THEN 'you' ELSE 'clinic' END) ORDER BY a.starts_at)
        FROM appointments a WHERE a.patient_id = s.patient_id AND a.status = 'booked' AND a.starts_at > now() - interval '120 days'), '[]'::jsonb) ELSE '[]'::jsonb END,
    'costs', CASE WHEN 'costs' = ANY(sec) THEN coalesce((
        SELECT jsonb_agg(jsonb_build_object('kind', f.kind, 'description', f.description, 'amountCents', f.amount_cents, 'on', f.occurred_on, 'dueOn', f.due_on,
                 'by', CASE WHEN f.source <> 'patient' THEN 'clinic' WHEN f.capture_id IS NOT NULL THEN 'read' ELSE 'you' END) ORDER BY f.occurred_on)
        FROM finance_ledger f WHERE f.patient_id = s.patient_id AND f.voided_at IS NULL), '[]'::jsonb) END,
    'coverage', CASE WHEN 'coverage' = ANY(sec) THEN coalesce((
        SELECT jsonb_agg(jsonb_build_object('payer', v.payer_name, 'plan', v.plan_name, 'asOf', v.as_of, 'fertilityUsedCents', v.lifetime_used_cents, 'fertilityMaxCents', v.lifetime_max_cents,
                 'deductibleCents', v.deductible_cents, 'deductibleMetCents', v.deductible_met_cents, 'oopMaxCents', v.oop_max_cents, 'oopMetCents', v.oop_met_cents,
                 'by', CASE WHEN v.source <> 'patient' THEN 'clinic' WHEN v.capture_id IS NOT NULL THEN 'read' ELSE 'you' END))
        FROM finance_coverage v WHERE v.patient_id = s.patient_id AND v.active), '[]'::jsonb) END
  );
  UPDATE summary_shares SET views = views + 1, last_viewed_at = now() WHERE id = s.id;
  INSERT INTO audit_events (clinic_id, actor_user_id, action, patient_id, detail)
    VALUES (s.clinic_id, s.created_by, CASE p_how WHEN 'pdf' THEN 'summary.downloaded_pdf' WHEN 'fhir' THEN 'summary.downloaded_data' ELSE 'summary.viewed_by_link' END,
            s.patient_id, jsonb_build_object('shareId', s.id, 'recipient', s.recipient));
  RETURN out;
END $$;
REVOKE EXECUTE ON FUNCTION kp_open_personal_summary(text, text) FROM PUBLIC, kp_app;

-- ---------- Standard codes on every lab result and medication (decision 5) ----------
-- Every lab result carries a LOINC code and every medication an RxNorm code, set on the way in by
-- whichever path added it (her, a document she checked, her clinic, the records connection).
CREATE TABLE lab_codes (analyte text PRIMARY KEY, loinc text NOT NULL, display text NOT NULL, checked text NOT NULL);
INSERT INTO lab_codes VALUES
  ('estradiol', '2243-4', 'Estradiol (E2) [Mass/volume] in Serum or Plasma', 'loinc.org, Oct 2026'),
  ('progesterone', '2839-9', 'Progesterone [Mass/volume] in Serum or Plasma', 'loinc.org, Oct 2026'),
  ('lh', '10501-5', 'Lutropin [Units/volume] in Serum or Plasma', 'loinc.org, Oct 2026'),
  ('fsh', '15067-2', 'Follitropin [Units/volume] in Serum or Plasma', 'loinc.org, Oct 2026'),
  ('hcg', '21198-7', 'Choriogonadotropin.beta subunit [Units/volume] in Serum or Plasma', 'loinc.org, Oct 2026'),
  ('amh', '38476-3', 'Mullerian inhibiting substance [Mass/volume] in Serum or Plasma', 'NOT YET CHECKED'),
  ('tsh', '3016-3', 'Thyrotropin [Units/volume] in Serum or Plasma', 'NOT YET CHECKED'),
  ('prolactin', '2842-3', 'Prolactin [Mass/volume] in Serum or Plasma', 'NOT YET CHECKED');
-- RxNorm codes are filled from NLM's RxNav by scripts/rxnorm-codes.mjs (names match case-insensitively).
CREATE TABLE med_codes (name text PRIMARY KEY, rxcui text NOT NULL, display text NOT NULL, checked text NOT NULL);
GRANT SELECT ON lab_codes, med_codes TO kp_app;

ALTER TABLE lab_results ADD COLUMN loinc text;
ALTER TABLE med_orders ADD COLUMN rxnorm text;
CREATE FUNCTION kp_code_lab() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.loinc IS NULL OR TG_OP = 'UPDATE' AND NEW.analyte IS DISTINCT FROM OLD.analyte THEN
    NEW.loinc := (SELECT loinc FROM lab_codes WHERE analyte = lower(NEW.analyte));
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION kp_code_med() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.rxnorm IS NULL OR TG_OP = 'UPDATE' AND NEW.medication IS DISTINCT FROM OLD.medication THEN
    NEW.rxnorm := (SELECT rxcui FROM med_codes WHERE name = lower(trim(NEW.medication)));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lab_results_code BEFORE INSERT OR UPDATE ON lab_results FOR EACH ROW EXECUTE FUNCTION kp_code_lab();
CREATE TRIGGER med_orders_code BEFORE INSERT OR UPDATE ON med_orders FOR EACH ROW EXECUTE FUNCTION kp_code_med();
UPDATE lab_results l SET loinc = c.loinc FROM lab_codes c WHERE c.analyte = lower(l.analyte) AND l.loinc IS NULL;

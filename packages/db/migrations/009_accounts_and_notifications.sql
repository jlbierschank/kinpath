-- Real sign-in, account settings, team management and notifications.

-- ---------- people ----------
ALTER TABLE app_users ADD COLUMN deactivated_at timestamptz;
ALTER TABLE app_users ADD COLUMN title text CHECK (char_length(title) <= 80);
ALTER TABLE app_users ADD COLUMN signature text CHECK (char_length(signature) <= 200);

-- Staff can edit their own profile; clinic admins manage staff (not patients). A trigger limits
-- exactly which columns each can change.
CREATE POLICY self_profile ON app_users FOR UPDATE USING (id = kp_user()) WITH CHECK (id = kp_user());
CREATE POLICY admin_manages_staff ON app_users FOR UPDATE
  USING (clinic_id = kp_clinic() AND kp_role() = 'clinic_admin')
  WITH CHECK (clinic_id = kp_clinic() AND kp_role() = 'clinic_admin');
CREATE POLICY admin_adds_staff ON app_users FOR INSERT
  WITH CHECK (clinic_id = kp_clinic() AND kp_role() = 'clinic_admin' AND role NOT IN ('patient','partner'));
GRANT INSERT, UPDATE ON app_users TO kp_app;

CREATE FUNCTION kp_user_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> 'kp_app' THEN RETURN NEW; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.clinic_id IS DISTINCT FROM OLD.clinic_id OR NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'that can''t be changed here';
  END IF;
  IF OLD.id = kp_user() THEN
    -- Your own profile: name, title, signature, language. Never your own role or status.
    IF NEW.role IS DISTINCT FROM OLD.role OR NEW.deactivated_at IS DISTINCT FROM OLD.deactivated_at THEN
      RAISE EXCEPTION 'you can''t change your own role or status';
    END IF;
  ELSE
    -- An admin managing someone else: staff only; role, status, name and title only.
    IF OLD.role IN ('patient','partner') OR NEW.role IN ('patient','partner') THEN
      RAISE EXCEPTION 'admins manage staff accounts only';
    END IF;
    IF NEW.signature IS DISTINCT FROM OLD.signature OR NEW.preferred_lang IS DISTINCT FROM OLD.preferred_lang THEN
      RAISE EXCEPTION 'only the person can change that';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER users_guard BEFORE UPDATE ON app_users FOR EACH ROW EXECUTE FUNCTION kp_user_guard();

-- ---------- sign-in (auth service only: the app role has no access at all) ----------
CREATE TABLE user_credentials (
  user_id uuid PRIMARY KEY REFERENCES app_users(id),
  password_hash text,
  password_changed_at timestamptz,
  totp_secret text,
  totp_enabled_at timestamptz
);
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES app_users(id),
  kind text NOT NULL CHECK (kind IN ('staff','patient')),
  device text,
  mfa_passed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE TABLE sign_in_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose text NOT NULL CHECK (purpose IN ('sign_in','join','setup')),
  user_id uuid REFERENCES app_users(id),
  invite_id uuid REFERENCES support_invites(id),
  join_name text,
  code_hash text NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE TABLE auth_failures (
  identifier text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_failures_idx ON auth_failures (identifier, at);
REVOKE ALL ON user_credentials, sessions, sign_in_codes, auth_failures FROM kp_app;

-- ---------- notifications ----------
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id text NOT NULL REFERENCES clinics(id),
  user_id uuid NOT NULL REFERENCES app_users(id),
  kind text NOT NULL,
  title text NOT NULL,
  link text,
  urgent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_notifications ON notifications FOR SELECT USING (user_id = kp_user() AND clinic_id = kp_clinic());
CREATE POLICY read_notifications ON notifications FOR UPDATE USING (user_id = kp_user()) WITH CHECK (user_id = kp_user());
GRANT SELECT, UPDATE ON notifications TO kp_app;
CREATE FUNCTION kp_notification_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'kp_app' AND (NEW.title IS DISTINCT FROM OLD.title OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.link IS DISTINCT FROM OLD.link OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.urgent IS DISTINCT FROM OLD.urgent) THEN
    RAISE EXCEPTION 'notifications can only be marked read';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER notifications_guard BEFORE UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION kp_notification_guard();

CREATE TABLE notification_prefs (
  user_id uuid NOT NULL REFERENCES app_users(id),
  kind text NOT NULL,
  in_app boolean, push boolean, sms boolean, email boolean,
  PRIMARY KEY (user_id, kind)
);
CREATE TABLE user_settings (
  user_id uuid PRIMARY KEY REFERENCES app_users(id),
  quiet_on boolean NOT NULL DEFAULT false,
  quiet_start time NOT NULL DEFAULT '21:00',
  quiet_end time NOT NULL DEFAULT '07:00',
  digest text NOT NULL DEFAULT 'off' CHECK (digest IN ('off','morning','evening')),
  phone text CHECK (char_length(phone) <= 30)
);
ALTER TABLE notification_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_prefs ON notification_prefs FOR ALL USING (user_id = kp_user()) WITH CHECK (user_id = kp_user());
CREATE POLICY own_settings ON user_settings FOR ALL USING (user_id = kp_user()) WITH CHECK (user_id = kp_user());
GRANT SELECT, INSERT, UPDATE ON notification_prefs, user_settings TO kp_app;

-- What would be sent by push, text or email. Health details never appear here.
-- Until a texting and an email service are connected (each with a signed HIPAA agreement),
-- nothing leaves the building: the dev outbox page shows what would have gone out.
CREATE TABLE outbox (
  id bigserial PRIMARY KEY,
  clinic_id text NOT NULL REFERENCES clinics(id),
  user_id uuid REFERENCES app_users(id),
  channel text NOT NULL CHECK (channel IN ('push','sms','email')),
  to_address text,
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL CHECK (status IN ('send','held','digest','sent')),
  send_after timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON outbox FROM kp_app;
REVOKE ALL ON outbox_id_seq FROM kp_app;

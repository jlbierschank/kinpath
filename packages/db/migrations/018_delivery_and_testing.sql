-- Sending what's in the outbox (email, text), and feedback from people testing Pumpkin.

ALTER TABLE outbox ADD COLUMN attempts int NOT NULL DEFAULT 0;
ALTER TABLE outbox ADD COLUMN sent_at timestamptz;
ALTER TABLE outbox ADD COLUMN last_error text CHECK (char_length(last_error) <= 300);
ALTER TABLE outbox DROP CONSTRAINT outbox_status_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_status_check CHECK (status IN ('send','held','digest','sent','failed'));
CREATE INDEX outbox_due ON outbox (send_after) WHERE status = 'send';

-- Feedback from the app. Written by the server for the signed-in person; nobody reads it in the app.
CREATE TABLE feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  screen text CHECK (char_length(screen) <= 60),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  app_version text CHECK (char_length(app_version) <= 40),
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON feedback FROM kp_app;

-- On managed Postgres the connecting user isn't a superuser, so it needs membership in kp_app
-- to switch into it inside each request (SET LOCAL ROLE kp_app). Harmless where it already has it.
DO $$
BEGIN
  EXECUTE format('GRANT kp_app TO %I', current_user);
EXCEPTION WHEN others THEN
  NULL;
END $$;

-- Three more stages for people on their own: before a clinic, pregnant after treatment, and eggs or embryos in storage.
-- What people see as the stage name lives in @kinpath/core (SOLO_STAGES); "just_starting" now reads "Getting started with a clinic".
ALTER TABLE personal_profiles DROP CONSTRAINT IF EXISTS personal_profiles_stage_check;
ALTER TABLE personal_profiles ADD CONSTRAINT personal_profiles_stage_check
  CHECK (stage IN ('trying','just_starting','freezing_eggs','in_cycle','two_week_wait','pregnant','after_hard_result','between_cycles','storage'));

-- How each draft was made, and why an AI draft was held back (if it was). Never the AI's raw text.
ALTER TABLE handoffs ADD COLUMN draft_engine text CHECK (draft_engine IN ('protocol','ai','ai_held_back','ai_error'));
ALTER TABLE handoffs ADD COLUMN draft_problems jsonb;

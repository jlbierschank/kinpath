-- Free AI reads: people on their own get a set number of AI reads each month to feel the benefit.
-- Premium (the $4.99 tier in the financial model) has no monthly limit. Typed and spoken notes always
-- work through the basic reader, and download and delete are never limited.
ALTER TABLE personal_profiles ADD COLUMN plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free','premium'));
-- True when the AI reader actually read this capture (what the allowance counts).
ALTER TABLE captures ADD COLUMN ai_read boolean NOT NULL DEFAULT false;

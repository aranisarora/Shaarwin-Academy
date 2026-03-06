CREATE TABLE public.otp_codes (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone        TEXT NOT NULL,
  code         TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  used         BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX otp_codes_phone_idx ON public.otp_codes(phone);

ALTER TABLE public.otp_codes ENABLE ROW LEVEL SECURITY;
-- No policies: only accessible via service role (admin client)

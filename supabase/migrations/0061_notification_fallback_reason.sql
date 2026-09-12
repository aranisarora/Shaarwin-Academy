-- `error` widens from "why nothing was delivered" to "why the channel we would
-- have preferred didn't carry it" — which now includes rows that DID go out.
--
-- The cost of the old, narrower meaning was paid on 2026-08-02: Twilio ran out
-- of funds at 16:37 UTC, the email fallback covered every message from that
-- moment on, and because nothing failed, nothing was ever written down. The
-- outage ran for four days. `channel_attempted` could show that WhatsApp-linked
-- members were being downgraded to email; nothing anywhere said why, because
-- the reason lived only in an edge-function log that rolls over after 24 hours.
--
-- So a sent row may now carry an error string. Read it as a note, not a fault:
--
--   status = 'failed'                 -> nothing delivered; error says why
--   status = 'sent'  and error null   -> delivered by the channel we wanted
--   status = 'sent'  and error set    -> delivered, but the hard way; error
--                                        says which channel we lost and why
--
-- Anything already counting failures on `status = 'failed'` is unaffected. Only
-- a query using `error is not null` as a proxy for failure needs the status
-- test adding — this migration is the notice that it does.

comment on column public.notifications.error is
  'Why the preferred channel did not carry this row (worker-written). On a failed row, why nothing was delivered at all; on a sent row, why it fell back to a lesser channel. Null when the intended channel worked.';

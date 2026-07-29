-- notification-fix-plan 1.5 — record WHY a delivery failed.
--
-- Until now `notifications` stored only status='failed'. Every diagnosis in the
-- Jul 2026 audit (unlinked founder account, unprovisioned template SIDs,
-- Keerthana's 191 silent failures) had to be *inferred* from row counts because
-- the worker threw the reason away. These two columns make the next audit a
-- query instead of an inference.
--
--   error             — human-readable reason, e.g.
--                       "whatsapp: not_linked; email: no_channel"
--                       or "whatsapp: 63016 template not approved"
--   channel_attempted — last channel we actually tried: whatsapp | email | none
--
-- Both nullable and additive: the currently-deployed worker keeps working
-- unchanged and simply leaves them null.

alter table public.notifications
  add column if not exists error text,
  add column if not exists channel_attempted text;

comment on column public.notifications.error is
  'Why delivery failed (worker-written). Null on pending/sent rows.';
comment on column public.notifications.channel_attempted is
  'Last delivery channel attempted: whatsapp | email | none.';

-- Failure triage: "what failed in the last 3 days and why".
create index if not exists notifications_failed_idx
  on public.notifications (created_at desc)
  where status = 'failed';

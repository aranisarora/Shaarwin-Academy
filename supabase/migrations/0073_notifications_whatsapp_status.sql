-- 0073 — record whether WhatsApp carried a notification, independently of
-- whether the row was delivered at all.
--
-- Email is additive, not a replacement. WhatsApp is the channel these members
-- actually read; email is what we do as well, so something lands. The delivery
-- chain used to collapse the two: any successful leg marked the row `sent`, and
-- a WhatsApp miss survived only as free text inside `error` — which the
-- deployed worker was not even writing.
--
-- The result was a failure mode that reported green. Two active coaches (Sunil
-- Hatti, Ramesh Simpi) and eleven clients had no WhatsApp binding at all and
-- were silently served email for months; 1,027 of 2,507 notifications since
-- 2026-08-01 went out by email, and a query for the reason returned ZERO rows.
--
-- `status` deliberately keeps its meaning ("did this reach them by any route")
-- so existing failure queries and retries are untouched. whatsapp_status
-- answers the separate question the founder actually needs: who are we failing
-- to reach on the channel that matters?

alter table public.notifications
  add column if not exists whatsapp_status text
  check (whatsapp_status in ('sent', 'failed', 'no_phone', 'skipped'));

comment on column public.notifications.whatsapp_status is
  'Did WhatsApp carry this row? sent | failed | no_phone (no number on the '
  'profile, never attempted) | skipped (an earlier channel ended the chain). '
  'Independent of status: a row can be status=sent via email while '
  'whatsapp_status=failed, and that combination is the one worth alerting on. '
  'Null on rows written before 0073 or by a worker older than it.';

-- Partial: the interesting rows are the ones WhatsApp did not carry, and they
-- are the minority. Answers "who did we miss on WhatsApp today".
create index if not exists notifications_whatsapp_missed_idx
  on public.notifications (whatsapp_status, created_at desc)
  where whatsapp_status in ('failed', 'no_phone');

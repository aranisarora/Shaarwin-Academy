-- notification-fix-plan 1.6 — dedupe inbound Twilio webhook retries.
--
-- Production evidence: the same coach message ("I've arrived") was processed 3×
-- within one second and three replies were sent. Twilio retries a webhook when
-- it doesn't see a timely 200 — and our handler acks immediately but does the
-- real work in `after()`, so a retry arrives while the first pass is still
-- running. Nothing downstream is idempotent, so the coach gets N replies.
--
-- The fix is a claim table keyed on Twilio's MessageSid, which is stable across
-- retries of the same inbound message. The PRIMARY KEY makes the claim atomic:
-- whichever request inserts first wins, the rest see a duplicate-key error and
-- silently ack.
--
-- No RLS policies: only the service-role client (the webhook) ever touches this.

create table if not exists public.wa_inbound_seen (
  message_sid text primary key,
  phone text,
  created_at timestamptz default now() not null
);

alter table public.wa_inbound_seen enable row level security;

comment on table public.wa_inbound_seen is
  'Claim table for inbound Twilio MessageSids — first insert wins, retries skip.';

-- Housekeeping: the table only needs a retry window's worth of history.
-- Twilio gives up retrying long before an hour, so a day of retention is ample.
create index if not exists wa_inbound_seen_created_at_idx
  on public.wa_inbound_seen (created_at);

create or replace function public.prune_wa_inbound_seen()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.wa_inbound_seen where created_at < now() - interval '1 day';
$$;

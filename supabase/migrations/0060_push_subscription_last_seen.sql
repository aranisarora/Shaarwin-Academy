-- Push subscriptions we can still believe in.
--
-- deliverPush() counted a push as delivered the moment the push SERVICE
-- accepted it, and for every type outside PUSH_ADDITIVE that ended the chain.
-- The trouble is that "accepted" says nothing about whether anyone will ever
-- see it. A desktop Chrome profile someone signed into once and never opened
-- again is a perfectly VALID subscription: it returns 201 for ever, is never
-- 404'd or 410'd, and so never self-cleans. One of those quietly absorbs that
-- person's entire informational tail — booking confirmations, reschedules,
-- receipts, assessment notes, the monthly progress note — all of which reach
-- them on WhatsApp today and would simply stop, with the row recording
-- channel_attempted='push' so no failure query would ever show it.
--
-- last_seen_at is the fact that was missing: the last time a live browser told
-- us this device still exists. PushToggle re-upserts on every mount, so a
-- device anyone actually opens stamps itself. The worker then lets push END the
-- chain only for an endpoint seen in the last 30 days; anything older still
-- gets the push, but WhatsApp follows it. Subscriptions nobody has touched in
-- 90 days are pruned by the notify worker.

alter table public.push_subscriptions
  add column if not exists last_seen_at timestamptz not null default now();

-- Rows that predate the column have never said hello since we started asking,
-- so they inherit their creation time rather than looking freshly seen — a
-- two-year-old subscription must not get 30 days of undeserved trust.
update public.push_subscriptions set last_seen_at = created_at;

create index if not exists push_subscriptions_last_seen_at_idx
  on public.push_subscriptions (last_seen_at);

-- Stamped by a trigger rather than by each caller. Every write to one of these
-- rows comes from a browser that is open right now, so "when was this row last
-- written" and "when was this device last alive" are the same fact — and a
-- caller that forgets to send the column can't make the row claim to be fresher
-- or staler than it is.
create or replace function public.touch_push_subscription()
returns trigger
language plpgsql
as $$
begin
  new.last_seen_at := now();
  return new;
end;
$$;

drop trigger if exists push_subscriptions_touch on public.push_subscriptions;
create trigger push_subscriptions_touch
  before insert or update on public.push_subscriptions
  for each row execute function public.touch_push_subscription();

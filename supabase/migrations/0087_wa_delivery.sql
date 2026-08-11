-- Delivery proof.
--
-- "Did Meera get the reminder?" has never had an answer. The system knows what
-- it QUEUED — notifications.status flips pending → sent the moment the worker
-- claims the row — and knows whether the carrier accepted the request. What
-- happened after that was invisible, which is why the assistant's honesty rules
-- have to be so strict about never upgrading "queued" to "delivered": it has
-- genuinely never been able to tell.
--
-- Meta's Cloud API reports per-message status transitions (sent → delivered →
-- read, or failed with a reason) on the same webhook that carries inbound
-- messages. This table is where they land, keyed by the carrier's own message
-- id, which is the only identifier both sides of the conversation share.
--
-- Service-role only, like the rest of the wa_* family.

create table if not exists public.wa_delivery (
  -- The carrier's id for the message (Meta's wamid, or Twilio's SM… sid).
  message_id text not null,
  phone text not null,
  -- queued | sent | delivered | read | failed. Text rather than an enum for the
  -- same reason wa_entity_memory.kind is: a carrier inventing a new status must
  -- never be able to fail the INSERT that is only trying to record it.
  status text not null default 'queued',
  -- Why it failed, in the carrier's words. Null while nothing has gone wrong.
  error text,
  -- The notification this message carried, when it came from the worker rather
  -- than from a live reply. Nullable and NOT a foreign key: a delivery receipt
  -- must be recordable even for a message whose notification row has since been
  -- pruned, and losing the receipt is worse than losing the link.
  notification_id uuid,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  constraint wa_delivery_pkey primary key (message_id)
);

-- "What happened to everything we sent this person" and "what failed today".
create index if not exists wa_delivery_phone_idx
  on public.wa_delivery (phone, created_at desc);
create index if not exists wa_delivery_failed_idx
  on public.wa_delivery (created_at desc)
  where status = 'failed';

alter table public.wa_delivery enable row level security;

comment on table public.wa_delivery is
  'Per-message delivery status from the WhatsApp carrier: queued → sent → delivered → read, or failed. The evidence behind "did they actually get it". Service-role only.';

-- Housekeeping: 90 days is long enough to answer "did they get it" about
-- anything anyone still remembers asking about.
create or replace function public.prune_wa_delivery()
returns void
language sql
security definer
set search_path to 'public'
as $function$
  delete from public.wa_delivery where created_at < now() - interval '90 days';
$function$;

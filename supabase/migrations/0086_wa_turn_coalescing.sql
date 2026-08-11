-- People text in fragments.
--
--   "cancel tomorrow"
--   "actually just move it"
--   "to 5pm"
--
-- Three inbound webhooks, three claims, three agent runs — each reading a
-- history that does not yet contain the others, each replying, and the first
-- one cheerfully cancelling a session the second sentence retracted. Nothing
-- here was a bug in the old sense: every run did exactly what it was told by
-- the fragment it could see.
--
-- Two things are needed to make a burst behave like a sentence:
--
--   1. A QUEUE, so a run can absorb the fragments that arrived beside it.
--      wa_inbound_seen already claims each MessageSid exactly once, which makes
--      it the natural place: the claim and the enqueue become one INSERT, and
--      there is no window where a message is claimed but not yet queued.
--
--   2. A LOCK per chat, so two runs never race on one thread. The winner
--      answers the whole burst; the loser returns, knowing its message is in
--      the queue and will be picked up.

-- The text of the message, so a run that did not receive a fragment directly
-- can still fold it in. Nullable: rows written before this migration have none,
-- and a button tap carries its meaning in the payload rather than the body.
alter table public.wa_inbound_seen add column if not exists body text;

-- Null while the message is still waiting for an answer. Set when a run has
-- folded it into a turn — which is NOT the same as "seen": the claim above
-- happens on arrival, this happens on being answered.
alter table public.wa_inbound_seen add column if not exists handled_at timestamptz;

-- The queue read is "this phone's unanswered messages, oldest first".
create index if not exists wa_inbound_seen_pending_idx
  on public.wa_inbound_seen (phone, created_at)
  where handled_at is null;

create table if not exists public.wa_chat_locks (
  phone text not null,
  -- A TTL rather than a boolean. A serverless run can die between taking the
  -- lock and releasing it, and a held-forever lock would silence a chat
  -- permanently — the one failure worse than a double reply.
  locked_until timestamptz not null,
  run_id uuid,
  created_at timestamptz default now() not null,
  constraint wa_chat_locks_pkey primary key (phone)
);

alter table public.wa_chat_locks enable row level security;

comment on table public.wa_chat_locks is
  'One agent run per chat at a time. TTL-based so a run that dies cannot silence a conversation. Service-role only.';

-- Take the lock, or report that someone else holds it.
--
-- The whole decision is one statement on purpose: INSERT .. ON CONFLICT DO
-- UPDATE .. WHERE takes row locks in the engine, so two webhooks arriving in
-- the same millisecond cannot both be told they won. A read-then-write in the
-- application could, and that is the race this exists to remove.
create or replace function public.wa_claim_chat(
  p_phone text,
  p_run uuid default null,
  p_ttl_seconds integer default 120
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.wa_chat_locks as l (phone, locked_until, run_id)
  values (p_phone, now() + make_interval(secs => p_ttl_seconds), p_run)
  on conflict (phone) do update
     set locked_until = excluded.locked_until,
         run_id       = excluded.run_id
   -- Only steal it if the holder's lease has expired.
   where l.locked_until < now();

  -- true when this call inserted or refreshed the lease; false when the WHERE
  -- above declined to touch a live one.
  return found;
end;
$function$;

-- Release early, so the next message does not wait out the TTL. Guarded by
-- run_id: a run whose lease already expired and was taken by someone else must
-- not release the new holder's lock on its way out.
create or replace function public.wa_release_chat(p_phone text, p_run uuid default null)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  delete from public.wa_chat_locks
   where phone = p_phone
     and (p_run is null or run_id is null or run_id = p_run);
$function$;

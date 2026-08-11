-- The bot's memory, moved out of its own prose.
--
-- Today the ONLY thing carried between turns is the visible transcript in
-- wa_messages. lintReply (correctly) rewrites every uuid in that text to "that
-- one" before it is persisted, because a founder should never be shown a uuid.
-- The two rules compose into amnesia: an id the bot resolved in one turn is
-- unrecoverable in the next, so "she", "that one" and "cancel it" have no
-- referent and get re-guessed from prose.
--
-- On 11 August that is what produced "I can't find a client named Aarav" and a
-- follow-up ("she had a class today") answered from an empty query — the player
-- id from the turn before had been linted away.
--
-- This table is the referent store. Entities the bot actually resolved are kept
-- per chat, keyed by phone, and injected into the model's context each turn.
-- Lint keeps cleaning what the PERSON sees; the model stops reading its memory
-- out of that cleaned text.
--
-- Service-role only, exactly like wa_messages and wa_inbound_seen: RLS enabled,
-- no policy. A chat's working memory stays out of the chat's own reach.

create table if not exists public.wa_entity_memory (
  phone text not null,
  -- 'player' | 'client' | 'coach' | 'class' | 'session' | 'venue' | 'booking'.
  -- Deliberately text and not an enum: the harvester learns new kinds as tools
  -- are added, and a new kind must never be able to fail an INSERT on the path
  -- that is only trying to remember something.
  kind text not null,
  entity_id uuid not null,
  -- What to call it in the injected context ("Aarav Sharma").
  label text not null,
  -- What tells it apart from a namesake ("Meera's child, Beginners").
  detail text,
  -- Bumped on every re-mention, so recency ordering is by USE rather than by
  -- first sight — the thing referred to three turns running stays hot.
  last_seen_at timestamptz default now() not null,
  mentions integer default 1 not null,
  created_at timestamptz default now() not null,
  constraint wa_entity_memory_pkey primary key (phone, kind, entity_id)
);

-- The read is always "this chat's most recent N", so order the index that way.
create index if not exists wa_entity_memory_phone_seen_idx
  on public.wa_entity_memory (phone, last_seen_at desc);

alter table public.wa_entity_memory enable row level security;

comment on table public.wa_entity_memory is
  'Per-chat working memory for the WhatsApp assistant: the entities it resolved, so pronouns and back-references survive the lint layer that strips ids from visible text. Service-role only.';

-- Housekeeping, in the same shape as prune_wa_inbound_seen(). A chat that has
-- gone quiet for a month has no referents worth keeping, and an id that stale is
-- likelier to be wrong than useful.
create or replace function public.prune_wa_entity_memory()
returns void
language sql
security definer
set search_path to 'public'
as $function$
  delete from public.wa_entity_memory
  where last_seen_at < now() - interval '30 days';
$function$;

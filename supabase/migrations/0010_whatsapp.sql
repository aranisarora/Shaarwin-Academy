-- 0010 — WhatsApp bot (Twilio): phone↔account links, single-use link codes,
-- and per-phone chat history for the LLM agent.
--
-- Security model: all three tables are service-role only. RLS is enabled with
-- NO policies, so browser/anon/authenticated clients can never touch them —
-- only the bot's server-side code (service key) and the webapp's server
-- actions (also service key) read or write here.

create table if not exists public.wa_links (
  phone      text primary key,                -- E.164 with whatsapp: prefix stripped, e.g. +919812345678
  user_id    uuid not null unique references public.profiles(id) on delete cascade,
  linked_at  timestamptz not null default now()
);

create table if not exists public.wa_link_codes (
  code       text primary key,                -- short human-typable code, e.g. TT-4F7K2N
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz
);

create index if not exists wa_link_codes_user_idx on public.wa_link_codes (user_id);

create table if not exists public.wa_messages (
  id         uuid primary key default gen_random_uuid(),
  phone      text not null,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  created_at timestamptz not null default now()
);

create index if not exists wa_messages_phone_idx on public.wa_messages (phone, created_at desc);

alter table public.wa_links enable row level security;
alter table public.wa_link_codes enable row level security;
alter table public.wa_messages enable row level security;

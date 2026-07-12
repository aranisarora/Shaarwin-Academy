-- 0025 — phone-first WhatsApp identity. Code-based linking (TT-XXXX) is
-- removed from the product, so profiles.phone is now the linchpin of the
-- phone↔account handshake: enforce one account per number, backfill wa_links
-- so notifications reach WhatsApp without waiting for a first inbound
-- message, and retire the wa_link_codes table.

-- Dedupe before the unique index: keep the number on the account that owns
-- the WhatsApp link (else the oldest), clear it on the rest.
with ranked as (
  select id,
         row_number() over (
           partition by phone
           order by (exists (select 1 from public.wa_links w where w.user_id = profiles.id)) desc,
                    created_at
         ) as rn
  from public.profiles
  where phone is not null and phone <> ''
)
update public.profiles p
set phone = null
from ranked r
where p.id = r.id and r.rn > 1;

update public.profiles set phone = null where phone = '';

create unique index if not exists profiles_phone_key
  on public.profiles (phone)
  where phone is not null;

-- Backfill: every account with a phone gets its wa_links row now — the
-- notification worker reads wa_links, not profiles.phone. Silence the
-- founder ops-feed trigger; these are not fresh link events.
alter table public.wa_links disable trigger wa_links_ops_feed;
insert into public.wa_links (phone, user_id)
select p.phone, p.id
from public.profiles p
where p.phone is not null
  and not exists (select 1 from public.wa_links w where w.user_id = p.id)
  and not exists (select 1 from public.wa_links w where w.phone = p.phone);
alter table public.wa_links enable trigger wa_links_ops_feed;

drop table if exists public.wa_link_codes;

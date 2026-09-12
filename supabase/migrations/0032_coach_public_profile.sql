-- Coach public-profile fields, so /coaches renders from the DB alone
-- (no more hardcoded roster), plus a bucket for admin-uploaded portraits.

-- 1. New editable public fields on coaches.
alter table public.coaches
  add column if not exists photo_url text,
  add column if not exists quote text,
  add column if not exists credentials text[] not null default '{}';

-- 2. Public bucket for standardized coach portraits.
insert into storage.buckets (id, name, public)
values ('coach-photos', 'coach-photos', true)
on conflict (id) do update set public = true;

-- Anyone may read a coach portrait; only founders may write/replace/remove.
drop policy if exists "coach photos public read" on storage.objects;
create policy "coach photos public read"
  on storage.objects for select
  using (bucket_id = 'coach-photos');

drop policy if exists "coach photos founder insert" on storage.objects;
create policy "coach photos founder insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'coach-photos'
    and exists (select 1 from public.profiles where id = auth.uid() and role = 'founder')
  );

drop policy if exists "coach photos founder update" on storage.objects;
create policy "coach photos founder update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'coach-photos'
    and exists (select 1 from public.profiles where id = auth.uid() and role = 'founder')
  );

drop policy if exists "coach photos founder delete" on storage.objects;
create policy "coach photos founder delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'coach-photos'
    and exists (select 1 from public.profiles where id = auth.uid() and role = 'founder')
  );

-- 3. Backfill the existing roster from the old static file so the public page
--    looks identical after the switch. Match on full name (spelling of the
--    portrait filename differs from the coach's name in a couple of cases).
--    Bios are left untouched — the DB already holds each coach's bio.
update public.coaches c set
  photo_url = '/images/coach-sampath.jpg',
  quote = 'Every point starts with the right mindset.',
  credentials = array['7+ years coaching','ITTF certified']
from public.profiles p
where p.id = c.id and p.full_name ilike 'Sampath%';

update public.coaches c set
  photo_url = '/images/coach-augustine.jpg',
  quote = 'Consistency wins matches. Confidence wins championships.',
  credentials = array['7+ years coaching','ITTF certified']
from public.profiles p
where p.id = c.id and p.full_name ilike 'Augustine%';

update public.coaches c set
  photo_url = '/images/coach-purnendu.jpg',
  quote = 'Every player has a champion inside — my job is to bring it out.',
  credentials = array['9+ years coaching','ITTF certified','NIS certified']
from public.profiles p
where p.id = c.id and p.full_name ilike 'Purnendu%';

update public.coaches c set
  photo_url = '/images/coach-nishchithh.jpg',
  quote = 'Master the basics, and the rest will follow.',
  credentials = array['4+ years coaching','ITTF certified']
from public.profiles p
where p.id = c.id and p.full_name ilike 'Nishchith%';

update public.coaches c set
  photo_url = '/images/coach-nandan.jpg',
  quote = 'Play with courage, win with strategy.',
  credentials = array['4+ years coaching','ITTF certified','State & National player']
from public.profiles p
where p.id = c.id and p.full_name ilike 'Nandhan%';

update public.coaches c set
  photo_url = '/images/coach-samir.jpg',
  quote = 'Success on the table is built through dedication off the table.',
  credentials = array['6 years coaching','ITTF certified','State & National player']
from public.profiles p
where p.id = c.id and p.full_name ilike 'Samir%';

update public.coaches c set
  photo_url = '/images/coach-rushi.jpg',
  quote = 'Mastering the basics is the first step to mastering the table.',
  credentials = array['3 years coaching','ITTF certified','State & National player']
from public.profiles p
where p.id = c.id and p.full_name ilike 'Rushi%';

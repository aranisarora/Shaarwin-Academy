-- Switch user-facing notification timestamps from 24-hour to 12-hour clock,
-- matching the app UI (e.g. "Sat 12 Jul, 6:30 pm"). Rebuilds each affected
-- function from its live definition with only the to_char format string
-- changed, so no other logic can drift.
do $$
declare
  defs text[];
  d text;
begin
  select array_agg(pg_get_functiondef(p.oid))
  into defs
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
    and pg_get_functiondef(p.oid) like '%HH24%';

  foreach d in array coalesce(defs, '{}')
  loop
    d := replace(d, 'Dy DD Mon, HH24:MI', 'Dy DD Mon, FMHH12:MI am');
    d := replace(d, 'Dy DD Mon HH24:MI',  'Dy DD Mon FMHH12:MI am');
    execute d;
  end loop;
end $$;

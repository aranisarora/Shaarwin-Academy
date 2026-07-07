-- 0008 — audit_log was read-only under RLS (only "founder reads audit" existed),
-- so every audit insert from the admin panel was silently dropped. Let the
-- founder write audit rows. Run once in the Supabase SQL editor.

drop policy if exists "founder writes audit" on audit_log;
create policy "founder writes audit" on audit_log
  for insert with check (is_founder());

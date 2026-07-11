-- Coaches must not see client contact details (email, phone, address).
-- Coach-facing UI only needs player names/levels, which come from public.players
-- (no contact columns) under its own coach RLS policy. Nothing coach-facing
-- reads client rows from profiles, so drop the row-level grant entirely.
drop policy if exists "coach reads clients in own sessions" on public.profiles;

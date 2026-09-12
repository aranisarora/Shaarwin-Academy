-- "Which coaches are connected to WhatsApp" — a question the bot could not answer.
--
-- 0010 declared all the wa_* tables service-role only: RLS enabled, no policies.
-- That held while the only reader was the webhook, which uses the service key
-- and bypasses RLS entirely. The agent's own database reads run on the CALLER's
-- session, so the one table that holds the answer is the one table it is denied,
-- and the founder was told the academy has no such data.
--
-- SELECT on wa_links, founder only. wa_messages and wa_inbound_seen stay
-- deny-all deliberately: the first is the chat transcript, and reading other
-- people's conversations is precisely what service-role-only exists to prevent;
-- the second is a dedupe claim table nobody will ever ask about.
--
-- The row is (phone, user_id, linked_at), and "founder all profiles" already
-- hands the founder every phone number in the academy. The single new fact is
-- WHETHER a link exists — which is the question.

drop policy if exists "founder reads wa links" on public.wa_links;
create policy "founder reads wa links" on public.wa_links
  for select using ((select is_founder()));

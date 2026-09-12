-- "Coach Samir says he didn't get any msg from you" — and nobody could check.
--
-- notifications has exactly one SELECT policy, `own notifications`
-- (user_id = auth.uid()), which is right for the app: a member reads their own
-- bell and nobody else's. But it means the founder cannot see the row he just
-- caused to be written. So when a coach reported a message never arrived, the
-- bot had no way to look, insisted it had been sent, and then invented a reason.
--
-- The rows are messages the academy sent about its own sessions, and the
-- founder already reads every profile, booking and session they refer to. What
-- he gains is the delivery record: status, which channel was attempted, when it
-- went, and the error if it didn't — the difference between "it's queued",
-- "it went at 20:35 over WhatsApp" and "it failed, here's why".
--
-- SELECT only. Writes stay with the RPCs and the worker; `founder writes
-- notifications` already covers the one insert path that needs it.

drop policy if exists "founder reads notifications" on public.notifications;
create policy "founder reads notifications" on public.notifications
  for select using ((select is_founder()));

-- 0034_rls_perf.sql
-- RLS performance: hoist per-query-constant auth expressions into scalar
-- subqueries so they evaluate once (InitPlan) instead of once per row.
--   auth.uid()   -> (select auth.uid())
--   is_founder() -> (select is_founder())
--   is_coach()   -> (select is_coach())
-- Column-argument helpers (class_is_public_group(class_id),
-- client_owns_private_class(...), coach_teaches_class(class_id),
-- coach_has_player(id)) are inherently per-row and left unchanged.
-- Semantics-preserving: identical rows, only evaluation frequency changes.
-- Also adds targeted covering indexes for hot / RLS-subquery foreign keys.

-- ── area_interest ────────────────────────────────────────────────────────────
alter policy "founder reads area interest" on public.area_interest
  using ((select is_founder()));

-- ── audit_log ────────────────────────────────────────────────────────────────
alter policy "founder reads audit" on public.audit_log
  using ((select is_founder()));
alter policy "founder writes audit" on public.audit_log
  with check ((select is_founder()));

-- ── booking_series ───────────────────────────────────────────────────────────
alter policy "clients read own series" on public.booking_series
  using ((client_id = (select auth.uid())));
alter policy "coaches read series on their sessions" on public.booking_series
  using ((exists ( select 1 from class_sessions s
                   where ((s.class_id = booking_series.class_id)
                     and (s.coach_id = (select auth.uid()))))));
alter policy "founder all series" on public.booking_series
  using ((select is_founder()));

-- ── bookings ─────────────────────────────────────────────────────────────────
alter policy "clients read own bookings" on public.bookings
  using ((client_id = (select auth.uid())));
alter policy "coaches read their rosters" on public.bookings
  using ((exists ( select 1 from class_sessions s
                   where ((s.id = bookings.session_id)
                     and (s.coach_id = (select auth.uid()))))));
alter policy "coaches write attendance" on public.bookings
  using ((exists ( select 1 from class_sessions s
                   where ((s.id = bookings.session_id)
                     and (s.coach_id = (select auth.uid()))))));
alter policy "founder full access" on public.bookings
  using ((select is_founder()));

-- ── class_credits ────────────────────────────────────────────────────────────
alter policy "own credits" on public.class_credits
  using (((client_id = (select auth.uid())) or (select is_founder())));
alter policy "founder writes credits" on public.class_credits
  using ((select is_founder()));

-- ── class_sessions ───────────────────────────────────────────────────────────
alter policy "coach updates own session notes" on public.class_sessions
  using ((coach_id = (select auth.uid())));
alter policy "founder writes sessions" on public.class_sessions
  using ((select is_founder()));
alter policy "read scheduled sessions" on public.class_sessions
  using ((class_is_public_group(class_id)
       or (coach_id = (select auth.uid()))
       or (select is_founder())
       or client_owns_private_class(class_id)));

-- ── classes ──────────────────────────────────────────────────────────────────
alter policy "founder writes classes" on public.classes
  using ((select is_founder()));
alter policy "public reads active group classes" on public.classes
  using (((((active = true) and (class_type = 'group'::class_type) and (is_school = false))
       or (select is_founder())
       or ((select is_coach()) and coach_teaches_class(id))
       or client_owns_private_class(id))));

-- ── client_invites ───────────────────────────────────────────────────────────
alter policy "founder all client invites" on public.client_invites
  using ((select is_founder()));

-- ── coach_assignments ────────────────────────────────────────────────────────
alter policy "assignments visible" on public.coach_assignments
  using (((coach_id = (select auth.uid())) or (select is_founder())));
alter policy "founder writes assignments" on public.coach_assignments
  using ((select is_founder()));

-- ── coach_availability ───────────────────────────────────────────────────────
alter policy "coach writes own availability" on public.coach_availability
  using ((coach_id = (select auth.uid())))
  with check ((coach_id = (select auth.uid())));
alter policy "founder all availability" on public.coach_availability
  using ((select is_founder()));

-- ── coach_time_off ───────────────────────────────────────────────────────────
alter policy "coach own time off" on public.coach_time_off
  using ((coach_id = (select auth.uid())))
  with check ((coach_id = (select auth.uid())));
alter policy "founder all time off" on public.coach_time_off
  using ((select is_founder()));

-- ── coaches ──────────────────────────────────────────────────────────────────
alter policy "coach writes own row" on public.coaches
  using ((id = (select auth.uid())));
alter policy "founder all coaches" on public.coaches
  using ((select is_founder()));
alter policy "public reads active coaches" on public.coaches
  using (((active = true) or (id = (select auth.uid())) or (select is_founder())));

-- ── coach_invites ────────────────────────────────────────────────────────────
alter policy "founder all coach invites" on public.coach_invites
  using ((select is_founder()));

-- ── invoices ─────────────────────────────────────────────────────────────────
alter policy "own invoices" on public.invoices
  using (((client_id = (select auth.uid())) or (select is_founder())));

-- ── notifications ────────────────────────────────────────────────────────────
alter policy "founder writes notifications" on public.notifications
  with check ((select is_founder()));
alter policy "mark own notifications read" on public.notifications
  using ((user_id = (select auth.uid())));
alter policy "own notifications" on public.notifications
  using ((user_id = (select auth.uid())));

-- ── orders ───────────────────────────────────────────────────────────────────
alter policy "own orders" on public.orders
  using (((client_id = (select auth.uid())) or (select is_founder())));
alter policy "founder writes orders" on public.orders
  using ((select is_founder()));

-- ── plans ────────────────────────────────────────────────────────────────────
alter policy "anyone reads active plans" on public.plans
  using (((active = true) or (select is_founder())));
alter policy "founder writes plans" on public.plans
  using ((select is_founder()));

-- ── products ─────────────────────────────────────────────────────────────────
alter policy "anyone reads active products" on public.products
  using (((active = true) or (select is_founder())));
alter policy "founder writes products" on public.products
  using ((select is_founder()));

-- ── players ──────────────────────────────────────────────────────────────────
alter policy "coach reads own rosters players" on public.players
  using (((select is_coach()) and coach_has_player(id)));
alter policy "founder all players" on public.players
  using ((select is_founder()));
alter policy "own household" on public.players
  using ((client_id = (select auth.uid())))
  with check ((client_id = (select auth.uid())));

-- ── private_booking_series ───────────────────────────────────────────────────
alter policy "clients read own private series" on public.private_booking_series
  using ((client_id = (select auth.uid())));
alter policy "founder all private series" on public.private_booking_series
  using ((select is_founder()));

-- ── private_class_details ────────────────────────────────────────────────────
alter policy "founder writes private details" on public.private_class_details
  using ((select is_founder()));
alter policy "private details visible to owner coach founder" on public.private_class_details
  using (((client_id = (select auth.uid()))
       or (select is_founder())
       or coach_teaches_class(class_id)));

-- ── private_credit_ledger ────────────────────────────────────────────────────
alter policy "founder writes ledger" on public.private_credit_ledger
  using ((select is_founder()));
alter policy "own ledger" on public.private_credit_ledger
  using (((client_id = (select auth.uid())) or (select is_founder())));

-- ── profiles ─────────────────────────────────────────────────────────────────
alter policy "founder all profiles" on public.profiles
  using ((select is_founder()));
alter policy "own profile" on public.profiles
  using ((id = (select auth.uid())))
  with check ((id = (select auth.uid())));

-- ── push_subscriptions ───────────────────────────────────────────────────────
alter policy "own push subscriptions" on public.push_subscriptions
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));

-- ── settings ─────────────────────────────────────────────────────────────────
alter policy "authenticated read settings" on public.settings
  using (((select auth.uid()) is not null));
alter policy "founder writes settings" on public.settings
  using ((select is_founder()));

-- ── student_notes ────────────────────────────────────────────────────────────
alter policy "coach or founder reads notes" on public.student_notes
  using (((select is_coach()) or (select is_founder())));
alter policy "coach or founder writes notes" on public.student_notes
  with check (((author_id = (select auth.uid())) and ((select is_coach()) or (select is_founder()))));
alter policy "author or founder deletes note" on public.student_notes
  using (((author_id = (select auth.uid())) or (select is_founder())));

-- ── subscriptions ────────────────────────────────────────────────────────────
alter policy "founder writes subscriptions" on public.subscriptions
  using ((select is_founder()));
alter policy "own subscriptions" on public.subscriptions
  using (((client_id = (select auth.uid())) or (select is_founder())));

-- ── venues ───────────────────────────────────────────────────────────────────
alter policy "founder writes venues" on public.venues
  using ((select is_founder()));
alter policy "public reads active venues" on public.venues
  using (((active = true) or (select is_founder())));

-- ── webhook_events ───────────────────────────────────────────────────────────
alter policy "founder reads webhook events" on public.webhook_events
  using ((select is_founder()));

-- ── Targeted covering indexes for unindexed foreign keys ─────────────────────
-- Hot paths / RLS helper subqueries / tables expected to grow.
create index if not exists bookings_player_id_idx on public.bookings (player_id);
create index if not exists notifications_user_id_idx on public.notifications (user_id);
create index if not exists class_credits_booking_id_idx on public.class_credits (booking_id);
create index if not exists class_credits_order_id_idx on public.class_credits (order_id);
create index if not exists orders_client_id_idx on public.orders (client_id);
create index if not exists orders_player_id_idx on public.orders (player_id);
create index if not exists orders_product_id_idx on public.orders (product_id);
create index if not exists private_credit_ledger_booking_id_idx on public.private_credit_ledger (booking_id);
create index if not exists private_credit_ledger_subscription_id_idx on public.private_credit_ledger (subscription_id);
create index if not exists invoices_client_id_idx on public.invoices (client_id);
create index if not exists invoices_subscription_id_idx on public.invoices (subscription_id);
create index if not exists subscriptions_plan_id_idx on public.subscriptions (plan_id);
create index if not exists private_class_details_client_id_idx on public.private_class_details (client_id);
create index if not exists private_class_details_player_id_idx on public.private_class_details (player_id);
create index if not exists coach_assignments_coach_id_idx on public.coach_assignments (coach_id);
create index if not exists student_notes_author_id_idx on public.student_notes (author_id);

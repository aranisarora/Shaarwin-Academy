alter policy "read scheduled sessions" on public.class_sessions
  using ((select is_founder()) or coach_id = (select auth.uid()) or class_is_public_group(class_id) or client_owns_private_class(class_id));

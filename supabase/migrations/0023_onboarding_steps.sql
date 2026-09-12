-- Multi-step onboarding: track how far a new client has progressed so the
-- flow can resume across devices. 0 = players pending, 1 = players saved,
-- 2 = WhatsApp connected (or phone confirmed), 3 = notification prefs saved.
-- profiles.onboarded_at remains the completion stamp; existing onboarded
-- accounts keep step 0 and are never routed back into the flow.
alter table public.profiles
  add column if not exists onboarding_step smallint default 0 not null;

-- notification-fix-plan 2.3 — STOP / START handling.
--
-- There is currently no opt-out path anywhere in lib/whatsapp/: a free-text
-- "STOP" falls through the deterministic layer and reaches the LLM, which
-- answers it conversationally. That is both a poor experience and a compliance
-- risk — WhatsApp/Meta expect an honoured opt-out.
--
-- Twilio's Advanced Opt-Out may or may not be intercepting these upstream (it
-- silently stops delivery at their edge). Either way the DATABASE has to know:
-- if Twilio drops the messages but we keep queueing them, every send looks
-- "sent" to us while the member hears nothing, and we lose the ability to tell
-- an opted-out member from a broken one.
--
-- wa_muted is deliberately separate from notification_prefs:
--   * notification_prefs is per-type and user-editable in the app;
--   * wa_muted is a hard channel-level gate the worker honours for everything
--     non-transactional, regardless of type — including types added later that
--     nobody remembered to add to the pref list.
-- STOP sets both (so the app UI reflects reality); START clears both.

alter table public.profiles
  add column if not exists wa_muted boolean not null default false;

comment on column public.profiles.wa_muted is
  'Member sent STOP over WhatsApp. Worker suppresses all non-transactional delivery. Cleared by START. See notification-fix-plan 2.3.';

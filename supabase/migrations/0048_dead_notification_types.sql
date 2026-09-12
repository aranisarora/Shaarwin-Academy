-- Six notification types are wired into the preferences UI
-- (`PREF_GROUP_FOR_TYPE` in supabase/functions/notify/index.ts) but nothing in
-- the codebase ever inserts them, so members can toggle switches that control
-- messages the academy has never sent:
--
--   new_class_open    payment_receipt    renewal_upcoming
--   assessment_ready  student_note       monthly_progress
--
-- Two whole preference categories are near-hollow as a result. "Progress"
-- promises "Monthly summaries, assessments and coach notes about your player"
-- and only `session_outcome` is live; "News & offers" promises "New classes,
-- camps, renewal notices" and only the manual `announcement` broadcast is.
--
-- This migration builds the four that are event-driven (a row appears → a
-- parent hears about it). The two time-driven ones (`renewal_upcoming`,
-- `monthly_progress`) are sweeps and live in the notify worker instead, next to
-- the digest, because nothing in the DB fires on "three days before a date".
--
-- All four are mutable: every one is a nice-to-have, and a parent of three who
-- is happy with the arrangement should be able to turn them off. None is
-- CAP_EXEMPT either, so they queue behind the daily cap rather than displacing
-- an arrival ping or a cancellation.

-- ── 1. payment_receipt ──────────────────────────────────────────────────────
-- Money currently only ever generates a message when it FAILS: both money
-- triggers notify the founder and stop. A family paying 4,500/month is told
-- when their card breaks and never told when it works.

CREATE OR REPLACE FUNCTION public.ops_notify_invoice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client text;
  v_plan   text;
  v_until  text;
begin
  -- One-off purchases are reported via the orders trigger; this covers renewals.
  if new.status <> 'paid' or new.subscription_id is null then return new; end if;
  select full_name into v_client from profiles where id = new.client_id;
  select p.name, to_char(s.current_period_end at time zone 'Asia/Kolkata', 'FMDD Mon')
    into v_plan, v_until
  from subscriptions s join plans p on p.id = s.plan_id
  where s.id = new.subscription_id;
  perform notify_founders('ops_payment', 'Payment received',
    fmt_inr(new.amount_pence) || ' from ' || coalesce(v_client, 'a client')
    || ' — ' || coalesce(v_plan, 'membership') || ' renewal.',
    jsonb_build_object('client_id', new.client_id, 'url', '/admin/billing'));

  -- The client's own receipt.
  if new.client_id is not null then
    insert into notifications (user_id, type, title, body, data)
    values (new.client_id, 'payment_receipt',
      'Payment received — thank you!',
      fmt_inr(new.amount_pence) || ' for ' || coalesce(v_plan, 'your membership')
      || coalesce('. You''re covered through ' || v_until, '') || '.',
      jsonb_build_object('amount_str', fmt_inr(new.amount_pence),
                         'plan_name', v_plan,
                         'covered_until', v_until,
                         'url', '/app/billing'));
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ops_notify_order_paid()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client  text;
  v_player  text;
  v_product text;
begin
  if new.status <> 'paid' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'paid' then return new; end if;
  select full_name into v_client from profiles where id = new.client_id;
  select full_name into v_player from players where id = new.player_id;
  select name into v_product from products where id = new.product_id;
  perform notify_founders('ops_payment', 'One-off purchase',
    coalesce(v_client, 'A client') || ' bought ' || coalesce(v_product, new.product_id)
    || ' (' || fmt_inr(new.amount_pence) || ')'
    || coalesce(' for ' || v_player, '') || '.',
    jsonb_build_object('client_id', new.client_id, 'url', '/admin/billing'));

  if new.client_id is not null then
    insert into notifications (user_id, type, title, body, data)
    values (new.client_id, 'payment_receipt',
      'Payment received — thank you!',
      fmt_inr(new.amount_pence) || ' for ' || coalesce(v_product, 'your purchase')
      || coalesce(' (' || v_player || ')', '') || '.',
      jsonb_build_object('amount_str', fmt_inr(new.amount_pence),
                         'plan_name', v_product,
                         'url', '/app/billing'));
  end if;
  return new;
end;
$function$;

-- ── 2. new_class_open ───────────────────────────────────────────────────────
-- There is no trigger on `classes` at all, so the only way a family learns a
-- class exists is the founder manually broadcasting `announcement` to EVERY
-- active client with no targeting whatsoever.
--
-- Targeting is deliberately conservative, because this is the one type here
-- with a large fan-out: group classes only (a private is arranged, not
-- offered), never a school class (those players have no account and their
-- parents didn't sign up for marketing), and only clients who already have a
-- player at the class's skill level. Everyone reached can mute it under
-- "News & offers", and the daily cap holds the overflow to the morning.

CREATE OR REPLACE FUNCTION public.ops_notify_class_open()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_venue text;
  v_when  text;
  v_body  text;
begin
  if not new.active or new.is_school or new.class_type <> 'group' then
    return new;
  end if;

  select name into v_venue from venues where id = new.venue_id;
  v_when := to_char(new.starts_on, 'FMDay FMDD Mon');

  v_body := 'A new ' || new.skill_level || ' class is open: ' || new.title
    || coalesce(' at ' || v_venue, '')
    || ', starting ' || v_when || '. Book a spot while there''s room.';

  insert into notifications (user_id, type, title, body, data)
  select distinct pl.client_id, 'new_class_open', 'New class open', v_body,
         jsonb_build_object('class_id', new.id,
                            'class_title', new.title,
                            'skill_level', new.skill_level,
                            'venue_name', v_venue,
                            'starts_on', new.starts_on,
                            'url', '/app/book')
    from players pl
    join profiles pr on pr.id = pl.client_id
   where pl.client_id is not null
     and pr.role = 'client'
     and pl.skill_level = new.skill_level
     and pl.school_venue_id is null;   -- school players aren't a marketing list

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS classes_notify_open ON public.classes;
CREATE TRIGGER classes_notify_open
  AFTER INSERT ON public.classes
  FOR EACH ROW EXECUTE FUNCTION ops_notify_class_open();

-- ── 3. assessment_ready ─────────────────────────────────────────────────────
-- `skill_assessments` + `skill_ratings` are fully built and coaches are nudged
-- to fill them in after EVERY class, but nothing anywhere tells the parent.
-- The entire assessment system is write-only. Throttled to one per player per
-- week so a keen coach can't turn it into a firehose.

CREATE OR REPLACE FUNCTION public.ops_notify_assessment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client uuid;
  v_first  text;
  v_coach  text;
  v_skills int;
begin
  select client_id, split_part(full_name, ' ', 1) into v_client, v_first
    from players where id = new.player_id;
  if v_client is null then return new; end if;   -- school player, no account

  -- One per player per week.
  if exists (
    select 1 from notifications
     where user_id = v_client
       and type = 'assessment_ready'
       and data->>'player_id' = new.player_id::text
       and created_at > now() - interval '7 days'
  ) then
    return new;
  end if;

  select split_part(full_name, ' ', 1) into v_coach from profiles where id = new.coach_id;
  select count(*) into v_skills from skill_ratings where assessment_id = new.id;

  insert into notifications (user_id, type, title, body, data)
  values (v_client, 'assessment_ready',
    v_first || '''s progress was updated',
    'Coach ' || coalesce(v_coach, 'your coach') || ' filed a new assessment for '
    || v_first || coalesce(' across ' || nullif(v_skills, 0) || ' skills', '')
    || '. See how they''re getting on.',
    jsonb_build_object('player_id', new.player_id,
                       'player_name', v_first,
                       'coach_name', v_coach,
                       'assessment_id', new.id,
                       'skill_count', v_skills,
                       'url', '/app/players'));
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS skill_assessments_notify ON public.skill_assessments;
CREATE TRIGGER skill_assessments_notify
  AFTER INSERT ON public.skill_assessments
  FOR EACH ROW EXECUTE FUNCTION ops_notify_assessment();

-- ── 4. student_note ─────────────────────────────────────────────────────────
-- Coach notes are written after class and never surfaced on their own.
--
-- The one real trap here: `session_outcome` (migration 0046) ALREADY quotes the
-- coach's note when it finds one written after the session started. Firing this
-- as well would send the same sentence twice. So this only fires for a note
-- that isn't already riding an outcome message — which in practice means notes
-- written outside the attendance flow.

CREATE OR REPLACE FUNCTION public.ops_notify_student_note()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client uuid;
  v_first  text;
  v_author text;
begin
  select client_id, split_part(full_name, ' ', 1) into v_client, v_first
    from players where id = new.player_id;
  if v_client is null then return new; end if;
  if new.author_id = v_client then return new; end if;  -- parent's own note

  -- Don't duplicate a note session_outcome is already quoting.
  if exists (
    select 1 from notifications
     where user_id = v_client
       and type = 'session_outcome'
       and data->>'player_id' = new.player_id::text
       and created_at > now() - interval '6 hours'
  ) then
    return new;
  end if;

  select split_part(full_name, ' ', 1) into v_author from profiles where id = new.author_id;

  insert into notifications (user_id, type, title, body, data)
  values (v_client, 'student_note',
    'A note about ' || v_first,
    'Coach ' || coalesce(v_author, 'your coach') || ' left a note for ' || v_first
    || ': "' || left(trim(new.body), 300) || '"',
    jsonb_build_object('player_id', new.player_id,
                       'player_name', v_first,
                       'coach_name', v_author,
                       'note_id', new.id,
                       'url', '/app/players'));
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS student_notes_notify ON public.student_notes;
CREATE TRIGGER student_notes_notify
  AFTER INSERT ON public.student_notes
  FOR EACH ROW EXECUTE FUNCTION ops_notify_student_note();

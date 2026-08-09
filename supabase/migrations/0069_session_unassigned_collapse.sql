-- `session_unassigned` is the loudest thing in the founders' phones.
--
-- Production, the fourteen days to 2026-08-08:
--
--   IST day     rows sent   distinct sessions   founders
--   2026-08-08     105             18              3
--   2026-08-02     120             12              3
--
-- 105 messages for 18 facts. Two separate multipliers are at work, and the
-- worse one is not the fan-out:
--
--   1. THE SAME SESSION, OVER AND OVER. One session produced 15 rows inside
--      twenty minutes. `assign_coach()` announces "no coach fits this slot"
--      every time it is called and fails, and it is called from every path that
--      touches scheduling — generate_class_sessions, the private-series cron,
--      booking, admin edits, the dropout cascade. Nothing asks whether the
--      founder has already been told. "This session has no coach" is a standing
--      condition, not an event, and re-announcing an unchanged condition is
--      pure noise.
--
--   2. FAN-OUT. A bulk operation unassigns twelve sessions and each one sends
--      its own message to each of three founders.
--
-- Neither is a bad click. Both are structural, and `session_unassigned` is the
-- one type with no backstop: the worker's per-user daily cap (0044 / notify
-- 2.2) has it in CAP_EXEMPT — deliberately, because a class with no coach is an
-- emergency — so it is also exempt from the only thing that was limiting it. It
-- goes out on push AND WhatsApp, every row, uncapped.
--
-- ── Where the fix goes ──────────────────────────────────────────────────────
--
-- At the queue site, exactly as 0043 did for `coach_changed`. Fixing
-- `assign_coach` alone would leave the dropout cascade, the WhatsApp fallback
-- in lib/whatsapp/tools/coach.ts, and the next writer to rediscover this.
--
-- `queue_session_alert()` is deliberately generic over type/title/body: it is a
-- queue site for "a standing condition about one session, told to one person",
-- so a future founder alert of the same shape inherits both guarantees free.
--
-- Two guarantees:
--
--   * ONE PERSON IS TOLD ABOUT ONE SESSION AT MOST ONCE PER IST DAY. This is
--     the dedupe, and it kills multiplier 1 outright. Keyed on a `session_ids`
--     set carried on the row, so a re-fire for a session already in today's
--     batch is a no-op rather than an increment — otherwise the summary would
--     read "47 sessions need a coach" when eighteen do.
--
--   * A BURST BECOMES ONE MESSAGE. While the row is still pending, further
--     sessions fold into it and it is rewritten as a summary. This is
--     multiplier 2.
--
-- Unlike 0043 the collapse spans the whole IST day rather than only pending
-- rows: with the notify worker on `* * * * *` a pending row lives about a
-- minute, so pending-only folding would have left a day's worth of separate
-- bursts intact — and for this type the daily cap is not there to catch them.
--
-- ── The batching delay, and why resolution comes with it ────────────────────
--
-- A new alert is scheduled 10 minutes out so a bulk operation lands in one
-- message (the 2026-08-02 burst spanned twenty minutes). Sessions starting
-- within 6 hours use 2 minutes instead, and an urgent session folding into a
-- pending batch pulls that batch FORWARD — `least(...)`, never later, so a slow
-- drip of new sessions can't starve one that matters.
--
-- Ten minutes of delay is only safe if the message can still be true when it
-- lands, so it is paired with resolution: filling, cancelling or deleting a
-- session drops it from any alert that has not gone out yet, and an alert whose
-- last session resolves is deleted unsent. Without that the founder assigns
-- three coaches and then gets told, nine minutes later, that three sessions
-- need one. Nothing already delivered is touched — that is history.
--
-- The founder's live view never depended on these rows anyway (/admin reads the
-- coach gaps straight from `class_sessions`), and `offer_cover_session()` still
-- goes out to coaches immediately and independently. The delay applies to the
-- founder's summary, which is the thing that was shouting.

-- ── 1. Rendering — one place, so a resolve re-renders like a queue ──────────
--
-- Kept out of the queue function because resolution rewrites the same sentence
-- from the other direction. The row carries its own `base_title` / `base_body`
-- / `summary_fmt` so a rewrite needs nothing but the row.
--
-- House style from 0055: name the first session and count the rest. A founder
-- reading "3 sessions need a coach" on a lock screen can act on it; "3 of your
-- sessions" was the wording that migration existed to kill.

create or replace function public._session_alert_text(
  p_sessions    jsonb,
  p_base_title  text,
  p_base_body   text,
  p_summary_fmt text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_n     int := coalesce(jsonb_array_length(p_sessions), 0);
  v_label text;
begin
  if v_n = 0 then
    return jsonb_build_object('title', p_base_title, 'body', p_base_body);
  end if;

  v_label := session_label((p_sessions ->> 0)::uuid);

  if v_n = 1 then
    -- Single session: the caller's sentence leads, the session names itself.
    return jsonb_build_object(
      'title', p_base_title,
      'body',  case when v_label is null then p_base_body
                    else rtrim(p_base_body, ' .') || ' — ' || v_label || '.' end);
  end if;

  return jsonb_build_object(
    'title', format(p_summary_fmt, v_n),
    'body',  coalesce(v_label || ' and ', '')
             || (v_n - 1) || ' other session' || case when v_n > 2 then 's' else '' end
             || ' have no coach — open the calendar to assign.');
end;
$function$;

comment on function public._session_alert_text is
  'Title/body for a session alert carrying N sessions. Names the first and counts the rest (0055 house style). Used by both queue_session_alert and the resolve trigger so a rewrite reads like a fresh queue.';

-- ── 2. The queue site ───────────────────────────────────────────────────────

create or replace function public.queue_session_alert(
  p_user        uuid,
  p_type        text,
  p_title       text,
  p_body        text,
  p_url         text,
  p_session     uuid,
  p_summary_fmt text default '%s sessions need a coach'
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_existing  notifications%rowtype;
  v_day_start timestamptz;
  v_sessions  jsonb;
  v_text      jsonb;
  v_starts    timestamptz;
  v_delay     interval;
begin
  if p_user is null or p_session is null then return; end if;

  -- Start of the current IST day. India has no DST so this is unambiguous.
  v_day_start := date_trunc('day', now() at time zone 'Asia/Kolkata')
                 at time zone 'Asia/Kolkata';

  -- Already told today? Then there is nothing new to say. `session_ids` is the
  -- set carried on the row; `session_id` is checked too so rows written before
  -- this migration still suppress on the day it ships.
  if exists (
    select 1 from notifications
    where user_id = p_user
      and type = p_type
      and created_at >= v_day_start
      and (data -> 'session_ids' @> to_jsonb(p_session::text)
           or data ->> 'session_id' = p_session::text)
  ) then
    return;
  end if;

  -- Urgency sets the batching delay: a session starting this morning is not
  -- something to sit on for ten minutes.
  select starts_at into v_starts from class_sessions where id = p_session;
  v_delay := case
               when v_starts is not null and v_starts < now() + interval '6 hours'
               then interval '2 minutes'
               else interval '10 minutes'
             end;

  select * into v_existing
  from notifications
  where user_id = p_user
    and type = p_type
    and status = 'pending'
    and created_at >= v_day_start
  order by created_at
  limit 1
  for update;

  if found then
    -- Fold into the batch that hasn't gone out yet.
    v_sessions := coalesce(v_existing.data -> 'session_ids', '[]'::jsonb)
                  || to_jsonb(p_session::text);
    v_text := _session_alert_text(
                v_sessions,
                coalesce(v_existing.data ->> 'base_title', p_title),
                coalesce(v_existing.data ->> 'base_body',  p_body),
                coalesce(v_existing.data ->> 'summary_fmt', p_summary_fmt));

    update notifications
    set title = v_text ->> 'title',
        body  = v_text ->> 'body',
        data  = v_existing.data || jsonb_build_object(
                  'session_ids', v_sessions,
                  'alert_count', jsonb_array_length(v_sessions),
                  'collapsed',   jsonb_array_length(v_sessions) > 1),
        -- Urgency may pull the batch forward. It must never push it back, or a
        -- steady trickle of new sessions would defer it indefinitely.
        scheduled_for = least(v_existing.scheduled_for, now() + v_delay)
    where id = v_existing.id;
    return;
  end if;

  v_sessions := jsonb_build_array(p_session::text);
  v_text := _session_alert_text(v_sessions, p_title, p_body, p_summary_fmt);

  insert into notifications (user_id, type, title, body, data, scheduled_for)
  values (p_user, p_type, v_text ->> 'title', v_text ->> 'body',
          jsonb_build_object(
            -- session_id stays the deep-link target: every existing consumer
            -- (admin inbox, WhatsApp interactive replies) reads it.
            'session_id',  p_session,
            'session_ids', v_sessions,
            'url',         p_url,
            'alert_count', 1,
            'collapsed',   false,
            'base_title',  p_title,
            'base_body',   p_body,
            'summary_fmt', p_summary_fmt),
          now() + v_delay);
end;
$function$;

comment on function public.queue_session_alert is
  'Queue a standing-condition alert about one session for one person. Tells them at most once per IST day per session, and folds a burst into one summary row. See migration 0069.';

-- ── 3. Founder fan-out, in one place ────────────────────────────────────────
--
-- All three writers had their own `select id from profiles where role=founder`.
-- One of them now, so who counts as a founder is decided once. `deleted_at` is
-- new here: a removed account was still being queued messages.

create or replace function public.alert_founders_session(
  p_type        text,
  p_title       text,
  p_body        text,
  p_url         text,
  p_session     uuid,
  p_summary_fmt text default '%s sessions need a coach'
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  f record;
begin
  for f in
    select id from profiles where role = 'founder' and deleted_at is null
  loop
    perform queue_session_alert(f.id, p_type, p_title, p_body, p_url,
                                p_session, p_summary_fmt);
  end loop;
end;
$function$;

comment on function public.alert_founders_session is
  'Queue a session alert for every active founder, collapsed per founder. The single definition of "tell the founders about this session".';

-- ── 4. Resolution — an undelivered alert stops being wrong ──────────────────
--
-- What makes the batching delay safe. Only `pending` rows are touched: anything
-- already sent is history and rewriting it would rewrite what someone read.

create or replace function public.resolve_session_alert(p_session uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r        record;
  v_left   jsonb;
  v_text   jsonb;
begin
  if p_session is null then return; end if;

  for r in
    select * from notifications
    where status = 'pending'
      and data -> 'session_ids' @> to_jsonb(p_session::text)
    for update
  loop
    -- Everything in the batch except the session that just resolved.
    select coalesce(jsonb_agg(s), '[]'::jsonb) into v_left
    from jsonb_array_elements(r.data -> 'session_ids') s
    where s <> to_jsonb(p_session::text);

    if jsonb_array_length(v_left) = 0 then
      -- Nothing left to report and it never went out. Say nothing.
      delete from notifications where id = r.id;
      continue;
    end if;

    v_text := _session_alert_text(
                v_left,
                coalesce(r.data ->> 'base_title', r.title),
                coalesce(r.data ->> 'base_body',  r.body),
                coalesce(r.data ->> 'summary_fmt', '%s sessions need a coach'));

    update notifications
    set title = v_text ->> 'title',
        body  = v_text ->> 'body',
        data  = r.data || jsonb_build_object(
                  'session_id',  (v_left ->> 0)::uuid,
                  'session_ids', v_left,
                  'alert_count', jsonb_array_length(v_left),
                  'collapsed',   jsonb_array_length(v_left) > 1)
    where id = r.id;
  end loop;
end;
$function$;

comment on function public.resolve_session_alert is
  'Drop a session from any session alert that has not been sent yet, deleting the alert if it was the last one. Makes the batching delay in queue_session_alert safe.';

create or replace function public._session_alert_resolve_trigger()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if tg_op = 'DELETE' then
    perform resolve_session_alert(old.id);
    return old;
  end if;

  -- A coach arrived, or the session stopped needing one at all.
  if (new.coach_id is not null and old.coach_id is distinct from new.coach_id)
     or (new.status is distinct from old.status and new.status <> 'scheduled')
  then
    perform resolve_session_alert(new.id);
  end if;

  return new;
end;
$function$;

drop trigger if exists class_sessions_resolve_alerts on public.class_sessions;
create trigger class_sessions_resolve_alerts
  after update or delete on public.class_sessions
  for each row execute function public._session_alert_resolve_trigger();

-- ── 5. The writers ──────────────────────────────────────────────────────────
--
-- Both now say what they mean in one line and inherit both guarantees. The
-- bodies are unchanged sentences; _session_alert_text appends the session name.

CREATE OR REPLACE FUNCTION public.assign_coach(p_session uuid, p_preferred uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_winner uuid;
  v_score numeric;
begin
  -- Never touch a locked assignment (E3)
  if exists (
    select 1 from coach_assignments
    where session_id = p_session and status = 'active' and locked
  ) then
    select coach_id into v_winner from coach_assignments
    where session_id = p_session and status = 'active' and locked;
    return v_winner;
  end if;

  select coach_id, score into v_winner, v_score
  from rank_coaches(p_session, p_preferred) limit 1;

  if v_winner is null then
    update class_sessions set coach_id = null where id = p_session;
    perform alert_founders_session(
      'session_unassigned', 'Session needs a coach',
      'No coach fits this slot — resolve it in the calendar.',
      '/admin/calendar', p_session);
    return null;
  end if;

  update coach_assignments set status = 'superseded'
  where session_id = p_session and status = 'active';

  insert into coach_assignments (session_id, coach_id, assigned_by, score, status)
  values (p_session, v_winner, null, v_score, 'active');

  update class_sessions set coach_id = v_winner where id = p_session;

  insert into audit_log (actor_id, action, entity, entity_id, meta)
  values (null, 'session.assign', 'class_sessions', p_session,
          jsonb_build_object('coach_id', v_winner, 'score', v_score));

  return v_winner;
end;
$function$;

CREATE OR REPLACE FUNCTION public.handle_coach_dropout(p_coach uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  c record;
  v_new uuid;
begin
  for r in
    select s.id
    from class_sessions s
    where s.coach_id = p_coach and s.status = 'scheduled'
      and s.starts_at >= p_from and s.starts_at < p_to
      and not exists (
        select 1 from coach_assignments a
        where a.session_id = s.id and a.status = 'active' and a.locked
      )
  loop
    -- exclude the dropping coach by temporarily deactivating is heavy; instead:
    update class_sessions set coach_id = null where id = r.id;
    update coach_assignments set status = 'superseded'
      where session_id = r.id and status = 'active';

    select rc.coach_id into v_new
    from rank_coaches(r.id) rc
    where rc.coach_id <> p_coach
    limit 1;

    if v_new is not null then
      insert into coach_assignments (session_id, coach_id, assigned_by, status)
      values (r.id, v_new, null, 'active');
      update class_sessions set coach_id = v_new where id = r.id;

      perform queue_coach_changed(v_new, r.id, 'You picked up a session',
              'Cover assigned to you automatically.', '/coach/calendar');

      for c in
        select distinct b.client_id
        from bookings b
        where b.session_id = r.id and b.status = 'confirmed'
      loop
        perform queue_coach_changed(c.client_id, r.id, 'Meet your new coach',
                'Your session has a new coach.', '/app/schedule');
      end loop;
    else
      perform alert_founders_session(
        'session_unassigned', 'Cover needed',
        'A coach dropped a session and no substitute fits.',
        '/admin/calendar', r.id, '%s sessions need cover');
      -- clients are NOT notified — founder decides the outcome
      --
      -- ...but before the founder has to ring anyone, offer it out (K8). This
      -- is a no-op when rank_coaches genuinely returns nobody, so the founder
      -- alert above stays the backstop rather than being replaced by it.
      perform offer_cover_session(r.id);
    end if;

    insert into audit_log (actor_id, action, entity, entity_id, meta)
    values (auth.uid(), 'session.dropout_cascade', 'class_sessions', r.id,
            jsonb_build_object('dropped_coach', p_coach, 'replacement', v_new));
  end loop;
end;
$function$;

-- ── 6. Reachability ─────────────────────────────────────────────────────────
--
-- SECURITY DEFINER writers, so they follow 0066: not reachable over PostgREST
-- by an anonymous or logged-in request. The SQL callers run as definer and are
-- unaffected; `service_role` keeps execute because the WhatsApp dropout
-- fallback in lib/whatsapp/tools/coach.ts calls queue_session_alert by RPC.

revoke execute on function public.queue_session_alert(uuid, text, text, text, text, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.alert_founders_session(text, text, text, text, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.resolve_session_alert(uuid)
  from public, anon, authenticated;
revoke execute on function public._session_alert_text(jsonb, text, text, text)
  from public, anon, authenticated;

grant execute on function public.queue_session_alert(uuid, text, text, text, text, uuid, text)
  to service_role;
grant execute on function public.alert_founders_session(text, text, text, text, uuid, text)
  to service_role;

-- ── 7. Index for the dedupe probe ───────────────────────────────────────────
--
-- Every queue does one "have I told them today" lookup against (user_id, type)
-- restricted to today. The existing indexes are (status, scheduled_for) and
-- (user_id) alone; on a table that grows by thousands a week the latter degrades
-- into scanning one founder's whole history on every unassignable session.

create index if not exists notifications_user_type_created_idx
  on public.notifications (user_id, type, created_at desc);

-- A wrap-up a busy coach can actually finish — and correct afterwards.
--
-- Two defects, one shape: the end-of-class paperwork was write-once and split
-- across screens, so a coach who got it wrong, or got interrupted, had no way
-- back in.
--
--   1. An assessment could be filed exactly once. `submitAssessment` inserts a
--      skill_assessments row, and skill_assessments_once_per_session (a partial
--      unique index on player+session+coach) makes the second attempt fail with
--      23505 — the app turns that into "Already assessed for that session."
--      There is no repair path at all: skill_assessments and skill_ratings each
--      carry an INSERT policy and a founder-only DELETE policy, and NO UPDATE
--      policy, so a coach cannot amend a rating even in principle. A coach who
--      fat-fingered a 1 onto a child who deserved a 4 left it there, and the
--      parent-facing mastery score was wrong for good.
--
--   2. The nag only ever counted assessments. get_pending_assessments filters
--      on `b.status = 'attended'`, which is the right filter for its own job but
--      makes unmarked attendance invisible: a session whose roster was never
--      touched has no attended bookings, so it contributes nothing to the
--      backlog and the prompt falls silent on the very thing that was skipped.
--      Attendance is also the gate for assessments — an unmarked roster hides
--      every assessment behind it — so the one screen that chases the coach was
--      blind to the block.
--
-- Fixes here are additive. `get_pending_assessments` keeps its exact signature
-- and behaviour because lib/whatsapp/interactive.ts reads it to compose the
-- after-class reply; the new queue sits beside it rather than replacing it.

-- ── 1. Editable assessments ──────────────────────────────────────────────────
--
-- SECURITY DEFINER rather than an UPDATE policy on the two tables. An UPDATE
-- policy would have to be written twice (assessment and rating), would let a
-- coach re-point an assessment's session_id or player_id, and still leaves the
-- caller doing find-or-create over two round trips with a race between them.
-- One function owns the whole edit instead, and the ownership check is the
-- first thing in it.
--
-- Find-or-create keyed on exactly the columns skill_assessments_once_per_session
-- indexes, so "this coach's assessment of this player for this class" has one
-- identity and a second save edits it. Ad-hoc assessments (p_session null) are
-- outside that index and stay append-only — they are dated notes, not a record
-- of one class, and nothing points back at them to correct.
create or replace function public.save_session_assessment(
  p_player uuid,
  p_session uuid default null,
  p_ratings jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_coach uuid := auth.uid();
  v_assessment uuid;
begin
  if v_coach is null then
    raise exception 'not_authenticated';
  end if;
  if not (is_coach() or is_founder()) then
    raise exception 'not_authorised';
  end if;

  -- Ownership. A founder may correct any coach's work (they already can via
  -- "view as coach"); a coach may only touch a session they are assigned to.
  if p_session is not null and not exists (
    select 1 from class_sessions s
     where s.id = p_session
       and (s.coach_id = v_coach or is_founder())
  ) then
    raise exception 'not_your_session';
  end if;

  if p_session is not null then
    select id into v_assessment
      from skill_assessments
     where player_id = p_player
       and session_id = p_session
       and coach_id = v_coach;
  end if;

  if v_assessment is null then
    insert into skill_assessments (player_id, coach_id, session_id)
    values (p_player, v_coach, p_session)
    returning id into v_assessment;
  end if;

  -- Only the skills the coach actually touched are sent, so this upserts and
  -- never deletes: a rating left alone keeps the value it had. Out-of-range
  -- values are dropped here rather than raising, because a partly-valid save
  -- from a coach on a bad connection is worth more than an all-or-nothing
  -- refusal — the check constraint on the column is still the backstop.
  insert into skill_ratings (assessment_id, skill_id, rating)
  select v_assessment,
         (r->>'skill_id')::uuid,
         (r->>'rating')::smallint
    from jsonb_array_elements(coalesce(p_ratings, '[]'::jsonb)) as r
   where (r->>'skill_id') is not null
     and (r->>'rating') ~ '^[1-5]$'
  on conflict (assessment_id, skill_id)
    do update set rating = excluded.rating;

  return v_assessment;
end;
$$;

comment on function public.save_session_assessment(uuid, uuid, jsonb) is
  'File or amend this coach''s assessment of a player for one session. '
  'Find-or-create on (player, session, coach) so a second save edits the first '
  'rather than failing the once_per_session index; ratings upsert, so skills '
  'the coach did not touch keep their values. Ad-hoc (p_session null) always '
  'inserts. Raises not_your_session unless the caller coaches that session or '
  'is the founder.';

-- The ops feed fires on INSERT only (skill_assessments_notify), so an edit
-- correctly does not re-announce itself to the founder. Stated here because it
-- is load-bearing: making that trigger fire on UPDATE would turn every
-- correction into a second "new assessment" in the feed.

-- ── 2. One queue: attendance and assessments ─────────────────────────────────
--
-- What the coach still owes, in the order they can act on it. Attendance rows
-- come first because they gate the assessments behind them — an unmarked roster
-- has no attended players, so its assessments cannot appear until it is done.
-- That ordering is what lets the prompt cycle to genuinely empty instead of
-- stalling on work the coach cannot yet see.
--
-- Seven days both sides: the same backlog window get_pending_assessments uses,
-- and the window the app's attendance actions now allow edits within, so the
-- queue can never name something the coach is not allowed to fix.
create or replace function public.get_coach_wrapup_queue(p_coach uuid default auth.uid())
returns table(
  kind text,
  session_id uuid,
  class_title text,
  session_ended_at timestamptz,
  player_id uuid,
  player_name text,
  pending_count integer
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if p_coach <> auth.uid() and not is_founder() then
    raise exception 'not_authorised';
  end if;

  return query
  -- Sessions that have ended with at least one booking still sitting at
  -- 'confirmed' — nobody said whether that child turned up. One row per
  -- session, carrying how many are outstanding.
  select 'attendance'::text,
         s.id,
         c.title,
         s.ends_at,
         null::uuid,
         null::text,
         count(*)::integer
    from bookings b
    join class_sessions s on s.id = b.session_id
    join classes c on c.id = s.class_id
   where s.coach_id = p_coach
     and b.status = 'confirmed'
     and s.ends_at < now()
     and s.ends_at > now() - interval '7 days'
   group by s.id, c.title, s.ends_at

  union all

  -- Players marked present whose assessment this coach has not filed. Mirrors
  -- get_pending_assessments exactly so the two can never disagree about what
  -- is outstanding.
  select 'assessment'::text,
         s.id,
         c.title,
         s.ends_at,
         b.player_id,
         pl.full_name,
         1
    from bookings b
    join class_sessions s on s.id = b.session_id
    join classes c on c.id = s.class_id
    join players pl on pl.id = b.player_id
   where s.coach_id = p_coach
     and b.status = 'attended'
     and s.ends_at < now()
     and s.ends_at > now() - interval '7 days'
     and not exists (
       select 1 from skill_assessments a
        where a.player_id = b.player_id
          and a.session_id = s.id
          and a.coach_id = p_coach
     )

  -- Attendance ahead of assessment within the same class, then oldest first —
  -- the order a coach would work through it anyway.
  order by 1 asc, 4 asc, 6 asc;
end;
$$;

comment on function public.get_coach_wrapup_queue(uuid) is
  'Everything a coach still owes on classes that have ended in the last 7 days: '
  'one ''attendance'' row per session with bookings left at confirmed (with the '
  'outstanding count), and one ''assessment'' row per attended player lacking '
  'this coach''s assessment. Attendance sorts first because it gates the '
  'assessments behind it. Superset of get_pending_assessments, which is kept '
  'unchanged for the WhatsApp after-class reply.';

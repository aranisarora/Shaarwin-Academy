-- An assessment filed from "view as coach" belongs to the coach, not the founder.
--
-- 0077 gave the founder an explicit route to correct a coach's work — its own
-- comment says so: "A founder may correct any coach's work (they already can via
-- view as coach)". But the function took the author from auth.uid() alone, so
-- what actually happened when the founder used that route was a *second*
-- assessment, authored by the founder, sitting beside the coach's wrong one.
--
-- Two things broke, and they compounded:
--
--   * The screen and the write disagreed about who was filing.
--     `getAssessmentForm` resolves `alreadyFiled` through `effectiveCoachId` —
--     the previewed coach — so the sheet said "not yet assessed", the founder
--     filed, and the coach's original rating was still there and still wrong.
--     The correction the founder came to make silently did not happen.
--
--   * The coach's backlog never cleared. `get_coach_wrapup_queue` and
--     `get_pending_assessments` both test `a.coach_id = p_coach`, so an
--     assessment filed by the founder does not answer the coach's outstanding
--     item. The prompt would keep chasing that coach for a child the founder had
--     already dealt with — the exact "queue that cannot be driven to empty"
--     failure 0077 set out to remove.
--
-- So the author becomes an argument. p_coach defaults to auth.uid(), which is
-- every ordinary coach call unchanged; passing someone else is the preview, and
-- is founder-only. The ownership check then reads against the coach being filed
-- for rather than the person typing, which is the same question the once-per-
-- session index asks.
--
-- The signature changes rather than gaining an overload: adding a fourth
-- defaulted parameter alongside the existing three-argument form would make
-- every current call ambiguous ("function is not unique"), so the old one is
-- dropped first.

drop function if exists public.save_session_assessment(uuid, uuid, jsonb);

create or replace function public.save_session_assessment(
  p_player uuid,
  p_session uuid default null,
  p_ratings jsonb default '[]'::jsonb,
  p_coach uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  -- Who is typing, and who the assessment is credited to. Equal for every coach
  -- filing their own; different only inside a founder's preview.
  v_actor uuid := auth.uid();
  v_coach uuid := coalesce(p_coach, auth.uid());
  v_assessment uuid;
begin
  if v_actor is null then
    raise exception 'not_authenticated';
  end if;
  if not (is_coach() or is_founder()) then
    raise exception 'not_authorised';
  end if;

  -- Filing under someone else's name is the preview, and the preview is the
  -- founder's alone. Checked before the session test so a coach probing with
  -- another coach's id is refused for the right reason.
  if v_coach <> v_actor and not is_founder() then
    raise exception 'not_authorised';
  end if;

  -- Ownership now asks about the coach being filed for. A founder may correct
  -- any session; a coach may only touch one they are assigned to.
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

comment on function public.save_session_assessment(uuid, uuid, jsonb, uuid) is
  'File or amend an assessment of a player for one session. Find-or-create on '
  '(player, session, coach) so a second save edits the first rather than failing '
  'the once_per_session index; ratings upsert, so skills the coach did not touch '
  'keep their values. Ad-hoc (p_session null) always inserts. p_coach defaults to '
  'the caller; passing another coach is the founder''s "view as coach" preview '
  'and is refused for anyone else, so a correction made in preview clears that '
  'coach''s backlog instead of opening a second assessment under the founder. '
  'Raises not_your_session unless that coach owns the session or the caller is '
  'the founder.';

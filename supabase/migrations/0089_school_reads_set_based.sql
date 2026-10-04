CREATE OR REPLACE FUNCTION public.school_player_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select pl.id from players pl
  where pl.client_id is null
    and pl.school_venue_id in (select school_admin_venues());
$function$;

CREATE OR REPLACE FUNCTION public.school_session_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select b.session_id
    from bookings b
    join players pl on pl.id = b.player_id
   where pl.client_id is null
     and pl.school_venue_id in (select school_admin_venues());
$function$;

alter policy "school reads own pupils" on public.players
  using ((select is_school_admin()) and id in (select school_player_ids()));

alter policy "school reads pupil bookings" on public.bookings
  using ((select is_school_admin()) and player_id in (select school_player_ids()));

alter policy "school reads pupil sessions" on public.class_sessions
  using ((select is_school_admin()) and id in (select school_session_ids()));

CREATE OR REPLACE FUNCTION public.get_players_mastery(p_players uuid[])
 RETURNS TABLE(player_id uuid, mastery integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with authorized as (
    select pl.id from players pl
    where pl.id = any(p_players)
      and (
        (select is_founder())
        or ((select is_coach()) and coach_has_player(pl.id))
        or pl.client_id = (select auth.uid())
        or ((select is_school_admin()) and pl.id in (select school_player_ids()))
      )
  ),
  n_skills as (select count(*)::int as n from skills where active),
  latest as (
    select distinct on (a.player_id, r.skill_id)
           a.player_id, r.skill_id, r.rating
      from skill_ratings r
      join skill_assessments a on a.id = r.assessment_id
      join skills s on s.id = r.skill_id and s.active
     where a.player_id = any(p_players)
     order by a.player_id, r.skill_id, a.created_at desc
  )
  select au.id,
         case when (select n from n_skills) = 0 then 0
              else round(100.0 * coalesce(sum(l.rating), 0)
                         / (5 * (select n from n_skills)))::int
         end
    from authorized au
    left join latest l on l.player_id = au.id
   group by au.id;
$function$;

drop function public.school_admin_session(uuid);

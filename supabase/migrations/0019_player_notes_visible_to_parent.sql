-- Let a player's parent (the client who owns the player row) read coach notes,
-- so the parent app can show them. Coaches/founder keep full access.
create or replace function public.get_player_notes(p_player uuid)
 returns table(id uuid, body text, created_at timestamptz, author_name text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not (
    is_coach() or is_founder()
    or exists (
      select 1 from players pl
       where pl.id = p_player and pl.client_id = auth.uid()
    )
  ) then
    raise exception 'not_authorised';
  end if;

  return query
    select n.id, n.body, n.created_at,
           coalesce(nullif(trim(p.full_name), ''), 'Coach') as author_name
      from student_notes n
      left join profiles p on p.id = n.author_id
     where n.player_id = p_player
     order by n.created_at desc;
end;
$function$;

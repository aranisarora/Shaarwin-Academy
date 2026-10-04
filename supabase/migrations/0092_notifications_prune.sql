create or replace function public.prune_notifications()
returns void
language sql
set search_path = public
as $$
  delete from public.notifications
   where status <> 'pending'
     and created_at < now() - interval '60 days'
     and type <> 'signup_request'
     and not (read_at is null and type in ('session_issue', 'private_request_parked', 'cover_offer'));
$$;

revoke all on function public.prune_notifications() from public, anon, authenticated;

select public.prune_notifications();

select cron.schedule('notifications-prune', '20 22 * * *', $$select public.prune_notifications()$$);

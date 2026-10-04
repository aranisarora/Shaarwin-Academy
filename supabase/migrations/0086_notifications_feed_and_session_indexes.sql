create index notifications_user_created_idx on public.notifications using btree (user_id, created_at desc);
create index notifications_type_session_idx on public.notifications using btree (type, (data ->> 'session_id'));
drop index public.notifications_user_id_idx;
analyze public.notifications;

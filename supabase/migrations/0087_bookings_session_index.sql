create index bookings_session_id_all_idx on public.bookings using btree (session_id);
drop index public.bookings_session_id_idx;
analyze public.bookings;

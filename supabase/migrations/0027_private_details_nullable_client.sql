-- Allow "open" private slots: a private session held on the calendar (coach +
-- venue + time) with no client assigned yet. Client/player are filled in later.
alter table public.private_class_details
  alter column client_id drop not null,
  alter column player_id drop not null;

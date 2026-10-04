delete from cron.job_run_details where start_time < now() - interval '7 days';

select public.prune_wa_inbound_seen();

select cron.schedule('cron-history-prune', '15 22 * * *',
  $$delete from cron.job_run_details where start_time < now() - interval '7 days'; select public.prune_wa_inbound_seen()$$);

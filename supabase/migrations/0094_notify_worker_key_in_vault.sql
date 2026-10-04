select vault.create_secret(
  (regexp_match((select command from cron.job where jobname = 'notify-worker'), 'Bearer ([A-Za-z0-9._-]+)'))[1],
  'notify_worker_key',
  'service_role key the notify-worker cron job sends to functions/v1/notify'
);

select cron.schedule('notify-worker', '* * * * *', $$select net.http_post(
  url := 'https://jkjgdpifimvnptpxjixk.supabase.co/functions/v1/notify',
  headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'notify_worker_key'))
)$$);

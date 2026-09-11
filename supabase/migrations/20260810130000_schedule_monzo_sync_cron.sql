-- Unschedule existing job if it exists
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'monzo-sync-every-3h';

-- Schedule the Monzo Edge Function to run every 3 hours (at minute 30 of every 3rd hour to stagger with Up and Wise sync)
SELECT cron.schedule(
  'monzo-sync-every-3h',
  '30 */3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://wlaydyjeilhinngtnnbd.supabase.co/functions/v1/monzo-sync-cron',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer sb_publishable_hwLBVLLUZAsgh7xI6GNSGw_Nc0XFxbg"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

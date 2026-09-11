-- Unschedule existing job if it exists
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'up-sync-every-3h';

-- Schedule the Edge Function to run every 3 hours (at minute 0 of every 3rd hour)
SELECT cron.schedule(
  'up-sync-every-3h',
  '0 */3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://wlaydyjeilhinngtnnbd.supabase.co/functions/v1/up-sync-cron',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer sb_publishable_hwLBVLLUZAsgh7xI6GNSGw_Nc0XFxbg"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

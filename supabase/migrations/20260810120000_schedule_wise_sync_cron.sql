-- Unschedule existing job if it exists
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'wise-sync-every-3h';

-- Schedule the Wise Edge Function to run every 3 hours (at minute 15 of every 3rd hour to stagger with Up sync)
SELECT cron.schedule(
  'wise-sync-every-3h',
  '15 */3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://wlaydyjeilhinngtnnbd.supabase.co/functions/v1/wise-sync-cron',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer sb_publishable_hwLBVLLUZAsgh7xI6GNSGw_Nc0XFxbg"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

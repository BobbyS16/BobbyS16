-- Système de ligues hebdo (3/4) : armage du cron pg_cron.
--
-- À exécuter APRÈS supabase_leagues_process_weekly.sql.
-- Migration appliquée sur Supabase prod le 2026-05-13.
--
-- Schedule : '10 23 * * 0' UTC = dimanche 23h10 UTC
--   = lundi 00h10 Paris (hiver, UTC+1)
--   = lundi 01h10 Paris (été,   UTC+2)
--
-- Pourquoi PAS '5 0 * * 1' UTC comme weekly_streak_bonus ?
--   Parce que ce job crée des bonus de streak au moment où il s'exécute.
--   Si on tournait APRÈS lui, ces bonus seraient comptés dans la semaine
--   suivante (filtre sur created_at dans get_user_weekly_points). En tournant
--   AVANT, on bilante proprement la semaine qui se termine.
--
-- Idempotence : si le job existe déjà, on le supprime puis on le re-schedule.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'weekly_league_changes') then
    perform cron.unschedule('weekly_league_changes');
  end if;
  perform cron.schedule(
    'weekly_league_changes',
    '10 23 * * 0',
    $cmd$ select public.process_weekly_league_changes(); $cmd$
  );
end $$;

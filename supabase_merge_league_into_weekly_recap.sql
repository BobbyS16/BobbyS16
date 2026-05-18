-- Fusion league_promotion/league_relegation dans weekly_recap.
-- Appliqué le 2026-05-18 via MCP (migration merge_league_changes_into_weekly_recap).
--
-- Avant : 2-3 notifs distinctes en début de semaine
--   - dim 23h10 UTC : league_promotion ou league_relegation (si changement)
--   - lun 7h UTC   : weekly_recap (stats)
--   - rien si l'user maintient sa ligue
--
-- Après : 1 seule notif weekly_recap lundi matin qui couvre tout
--   - stats (sessions, km, pts, rang amis)
--   - statut ligue (promoted / relegated / stay)
--   - si stay : position et taille dans la ligue
--   - si changement : from / to league
--
-- Implémentation :
--   1. Nouvelle table weekly_league_changes : log audit par user/semaine
--   2. Cron weekly_league_changes décalé à lundi 6h55 UTC (avant le recap)
--   3. process_weekly_league_changes ne crée plus de notifications
--      → insère dans weekly_league_changes à la place
--   4. notify_weekly_recap_run lit weekly_league_changes pour enrichir le
--      payload avec current_league / league_status / previous_league /
--      league_position / league_size

create table if not exists public.weekly_league_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  week_start date not null,
  from_league text not null,
  to_league text not null,
  status text not null check (status in ('promoted','relegated')),
  week_points int,
  created_at timestamptz default now(),
  unique (user_id, week_start)
);

alter table public.weekly_league_changes enable row level security;
drop policy if exists wlc_select_own on public.weekly_league_changes;
create policy wlc_select_own on public.weekly_league_changes
  for select using (user_id = auth.uid());

select cron.unschedule('weekly_league_changes');
select cron.schedule('weekly_league_changes', '55 6 * * 1', 'select public.process_weekly_league_changes();');

-- Note : pour les définitions complètes de process_weekly_league_changes()
-- et notify_weekly_recap_run() recréées dans cette migration, voir la
-- migration MCP du même nom (le code SQL est trop volumineux pour être
-- dupliqué ici sans risque d'incohérence). En cas de besoin, dump via
-- pg_get_functiondef('public.process_weekly_league_changes'::regproc).

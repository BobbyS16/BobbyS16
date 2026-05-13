-- Système de ligues hebdo : persistance des points de course en BDD.
-- Indispensable pour que process_weekly_league_changes() puisse sommer
-- côté SQL les points marqués par un user sur une semaine donnée.
-- Les points sont calculés client-side via calcPoints(discipline, time, elevation)
-- et stockés à chaque INSERT/UPDATE d'un result.
-- Migration appliquée sur Supabase prod le 2026-05-13.

alter table public.results add column if not exists points integer not null default 0;

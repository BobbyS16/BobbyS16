-- Système de ligues hebdo (1/4) : calcul des points marqués sur une semaine.
--
-- get_user_weekly_points(target_user_id, week_start)
--   week_start = lundi (date) de la semaine à évaluer
--   retourne   = somme integer des points marqués sur la fenêtre
--                [week_start 00h00 Europe/Paris ; week_start+7j 00h00 Europe/Paris)
--
-- Sources additionnées :
--   - trainings.points      filtré sur trainings.date (date locale)
--   - results.points        filtré sur coalesce(race_date, created_at::date)
--   - point_bonuses.points  filtré sur created_at timestamptz
--
-- Migration appliquée sur Supabase prod le 2026-05-13.
-- Idempotente (CREATE OR REPLACE).

create or replace function public.get_user_weekly_points(
  target_user_id uuid,
  week_start date
) returns integer
language sql
stable
as $$
  with bounds as (
    select
      week_start                                                       as ws_date,
      (week_start + 7)                                                 as we_date_excl,
      (week_start::timestamp at time zone 'Europe/Paris')              as ws_ts,
      ((week_start + 7)::timestamp at time zone 'Europe/Paris')        as we_ts
  )
  select
    coalesce((
      select sum(t.points)::integer
      from public.trainings t, bounds b
      where t.user_id = target_user_id
        and t.date  >= b.ws_date
        and t.date  <  b.we_date_excl
    ), 0)
    +
    coalesce((
      select sum(r.points)::integer
      from public.results r, bounds b
      where r.user_id = target_user_id
        and coalesce(r.race_date, r.created_at::date) >= b.ws_date
        and coalesce(r.race_date, r.created_at::date) <  b.we_date_excl
    ), 0)
    +
    coalesce((
      select sum(pb.points)::integer
      from public.point_bonuses pb, bounds b
      where pb.user_id = target_user_id
        and pb.created_at >= b.ws_ts
        and pb.created_at <  b.we_ts
    ), 0);
$$;

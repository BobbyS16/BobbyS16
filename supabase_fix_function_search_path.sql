-- Fige search_path sur les 7 fonctions remontées par Supabase Security Advisor
-- ("Function Search Path Mutable"). Appliqué le 2026-05-19 via MCP
-- (migration fix_function_search_path_mutable).
--
-- Contexte : Supabase Security Advisor flaggait 7 fonctions sans search_path
-- figé. Sans search_path, théoriquement un attaquant pourrait créer un schéma
-- malicieux qui hijack une fonction appelée par la fonction (très improbable
-- sur Supabase managé, mais best practice + ferme les warnings).
--
-- search_path = public, pg_catalog :
--   - public     : résolution des tables/fonctions du projet
--   - pg_catalog : fonctions/types Postgres standards (now(), text, etc.)
--
-- Pas de changement de comportement. Sécurise juste la résolution de noms.

alter function public._comments_touch_updated_at()
  set search_path = public, pg_catalog;

alter function public.ensure_user_league()
  set search_path = public, pg_catalog;

alter function public.get_user_weekly_points(target_user_id uuid, week_start date)
  set search_path = public, pg_catalog;

alter function public.process_weekly_league_changes()
  set search_path = public, pg_catalog;

alter function public.race_pronostics_check_not_self()
  set search_path = public, pg_catalog;

alter function public.race_pronostics_touch_updated_at()
  set search_path = public, pg_catalog;

alter function public.upcoming_races_touch_updated_at()
  set search_path = public, pg_catalog;

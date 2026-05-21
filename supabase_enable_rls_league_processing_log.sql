-- Active RLS sur league_processing_log sans aucune policy.
-- Appliqué le 2026-05-19 via MCP (migration enable_rls_league_processing_log).
--
-- Contexte : Supabase Security Advisor remontait 1 error "RLS Disabled in Public"
-- sur cette table. Elle n'est lue/écrite QUE par la fonction cron
-- process_weekly_league_changes() qui tourne en SECURITY DEFINER (donc bypass RLS).
-- Aucun user (anon ou authenticated) ne doit pouvoir y accéder via l'API REST.
--
-- Sans policy + RLS activé = lockdown total pour les rôles non-superuser.
-- Les SECURITY DEFINER functions continuent de fonctionner normalement.

alter table public.league_processing_log enable row level security;

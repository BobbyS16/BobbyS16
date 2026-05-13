-- Célébrations : changement de statut saison (Débutant → UltraStar).
-- À exécuter une seule fois dans le SQL editor de Supabase.

alter table profiles add column if not exists last_season_level_seen text;

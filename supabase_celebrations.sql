-- Célébrations : promotion de ligue + palier de points + toggle d'animations.
-- À exécuter une seule fois dans le SQL editor de Supabase.

alter table profiles add column if not exists last_league_seen text default 'bronze';
alter table profiles add column if not exists last_points_milestone integer default 0;
alter table profiles add column if not exists celebrations_enabled boolean default true;

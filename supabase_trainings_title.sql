-- Ajoute une colonne `title` (texte libre, optionnelle) à la table trainings.
-- Sert pour les activités saisies manuellement (l'utilisateur peut donner un titre)
-- et pour les imports Strava/Garmin (le titre de l'activité Strava est repris automatiquement).
-- À exécuter une seule fois dans le SQL editor de Supabase.
alter table trainings add column if not exists title text;

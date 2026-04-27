-- Ajoute une colonne `source` à la table trainings pour identifier
-- la provenance d'une activité (saisie manuelle, import Strava, futur Garmin…)
-- Valeurs possibles : 'manual' (défaut), 'strava', 'garmin'

alter table public.trainings
  add column if not exists source text default 'manual';

-- Index pour permettre la purge ciblée des activités Strava lors d'une
-- déconnexion (where source = 'strava' and user_id = ?)
create index if not exists trainings_source_idx
  on public.trainings (user_id, source);

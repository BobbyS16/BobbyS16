-- Classification "course officielle vs entraînement" pour les activités importées/saisies.
-- À exécuter une seule fois dans le SQL editor de Supabase.

alter table trainings add column if not exists is_official_race boolean not null default false;
alter table trainings add column if not exists auto_detected_official boolean not null default false;
alter table trainings add column if not exists classification_status text not null default 'pending';
alter table trainings add column if not exists official_race_format text;
alter table trainings add column if not exists official_race_name text;
alter table trainings add column if not exists official_race_location text;
alter table trainings add column if not exists linked_result_id uuid references results(id) on delete set null;

-- Garde-fou : seules ces 3 valeurs sont autorisées pour classification_status.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'trainings_classification_status_check') then
    alter table trainings add constraint trainings_classification_status_check
      check (classification_status in ('pending','classified_as_training','classified_as_race'));
  end if;
end$$;

-- Index pour accélérer la requête du bandeau "À classer".
create index if not exists idx_trainings_pending_official on trainings (user_id, classification_status, auto_detected_official)
  where auto_detected_official = true and classification_status = 'pending';

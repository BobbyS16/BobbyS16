-- Étend les disciplines de upcoming_races à 6 catégories
-- (course / velo / natation / trail / tri / hyrox) et renomme les rows
-- existantes 'run' en 'course' pour la cohérence sémantique. Ajoute
-- aussi une colonne elevation_gain_m optionnelle pour le D+ annoncé
-- des courses (trail, route vallonnée, vélo de montagne...).

update public.upcoming_races set discipline = 'course' where discipline = 'run';

alter table public.upcoming_races drop constraint if exists upcoming_races_discipline_check;
alter table public.upcoming_races
  add constraint upcoming_races_discipline_check
  check (discipline in ('course','velo','natation','trail','tri','hyrox'));

alter table public.upcoming_races add column if not exists elevation_gain_m integer;

-- Ajout du champ photo_url sur trainings + results pour les cards d'activité
-- du fil ACTU (étape 1 : schéma seul, l'upload côté user vient ensuite).

alter table public.trainings add column if not exists photo_url text;
alter table public.results   add column if not exists photo_url text;

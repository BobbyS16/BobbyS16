-- Bug : quand un user supprimait une course (results) ou un entraînement
-- (trainings), les bonus liés dans point_bonuses restaient orphelins.
-- Ex : course → +50 pts pr_beaten → supprime la course → les +50 pts
-- restaient comptés dans le total saison.
--
-- Appliqué le 2026-05-20 via MCP (migration
-- cleanup_orphan_bonuses_on_activity_delete).
--
-- Fix :
--   1. Nettoyage one-shot des orphelins actuels (3 lignes, 150 pts effacés)
--   2. Trigger BEFORE DELETE sur results et trainings qui supprime les
--      bonus dont le metadata pointe vers l'id à supprimer.

-- ─── 1. Nettoyage one-shot des orphelins existants ───
delete from public.point_bonuses
where bonus_type = 'pr_beaten'
  and metadata->>'result_id' is not null
  and (metadata->>'result_id')::uuid not in (select id from public.results);

-- Autres bonus_type qui pourraient référencer un result_id ou training_id
-- (préventif : si on ajoute des nouveaux types qui suivent la même convention)
delete from public.point_bonuses
where metadata->>'result_id' is not null
  and (metadata->>'result_id')::uuid not in (select id from public.results);

delete from public.point_bonuses
where metadata->>'training_id' is not null
  and (metadata->>'training_id')::uuid not in (select id from public.trainings);

-- ─── 2. Trigger sur DELETE results : clean bonuses référençant result.id ───
create or replace function public.cleanup_bonuses_on_result_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  delete from public.point_bonuses
  where metadata->>'result_id' = OLD.id::text;
  return OLD;
end;
$$;

drop trigger if exists trg_cleanup_bonuses_on_result_delete on public.results;
create trigger trg_cleanup_bonuses_on_result_delete
  before delete on public.results
  for each row
  execute function public.cleanup_bonuses_on_result_delete();

-- ─── 3. Trigger sur DELETE trainings : idem pour training_id ───
create or replace function public.cleanup_bonuses_on_training_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  delete from public.point_bonuses
  where metadata->>'training_id' = OLD.id::text;
  return OLD;
end;
$$;

drop trigger if exists trg_cleanup_bonuses_on_training_delete on public.trainings;
create trigger trg_cleanup_bonuses_on_training_delete
  before delete on public.trainings
  for each row
  execute function public.cleanup_bonuses_on_training_delete();

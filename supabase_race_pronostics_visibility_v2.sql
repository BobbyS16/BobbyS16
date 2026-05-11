-- race_pronostics — visibilité v2
-- Avant : ami du coureur OU ami du predictor → voit tout. Trop permissif.
-- Maintenant, le SELECT n'est autorisé que si l'une de ces conditions est vraie :
--   1. predictor_id = auth.uid()                  → on voit son propre prono
--   2. user de la course = auth.uid()             → le coureur voit tous les pronos sur sa course
--   3. course terminée (race_date < current_date) ET ami du coureur
--                                                 → après la course, les amis du coureur découvrent tout
-- Le compteur public ("X amis ont déjà pronostiqué") passe par get_race_prono_count
-- (SECURITY DEFINER) qui retourne juste un count sans exposer les pronos.

drop policy if exists "race_pronostics_select" on public.race_pronostics;
create policy "race_pronostics_select" on public.race_pronostics
  for select using (
    predictor_id = auth.uid()
    or exists (
      select 1 from public.upcoming_races r
       where r.id = race_pronostics.upcoming_race_id
         and r.user_id = auth.uid()
    )
    or exists (
      select 1
        from public.upcoming_races r
        join public.friendships f on (
          (f.user_id   = auth.uid() and f.friend_id = r.user_id)
          or (f.friend_id = auth.uid() and f.user_id   = r.user_id)
        )
       where r.id = race_pronostics.upcoming_race_id
         and r.race_date < current_date
         and f.status = 'accepted'
    )
  );

-- Compteur public. SECURITY DEFINER pour pouvoir compter sans que le caller
-- ait le droit SELECT sur les rows individuelles. Restreint aux personnes qui
-- peuvent VOIR la course (coureur OU ami du coureur), pour ne pas exposer
-- l'activité de comptes externes.
create or replace function public.get_race_prono_count(p_race_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_uid uuid;
  v_count int;
begin
  v_uid := auth.uid();
  if v_uid is null then return 0; end if;

  select user_id into v_owner from public.upcoming_races where id = p_race_id;
  if v_owner is null then return 0; end if;

  if v_owner <> v_uid then
    if not exists (
      select 1 from public.friendships f
       where f.status = 'accepted'
         and ((f.user_id   = v_uid and f.friend_id = v_owner)
           or (f.friend_id = v_uid and f.user_id   = v_owner))
    ) then
      return 0;
    end if;
  end if;

  select count(*) into v_count from public.race_pronostics where upcoming_race_id = p_race_id;
  return v_count;
end;
$$;

grant execute on function public.get_race_prono_count(uuid) to authenticated;

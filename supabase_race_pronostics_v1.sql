-- ── race_pronostics — pronostics des amis sur les courses à venir ───────
-- Brique 2 du flow pronostics. La table upcoming_races (brique 1) liste
-- les courses futures déclarées ; ici on ajoute les pronos déposés par
-- les amis sur ces courses.
--
-- Contraintes principales :
--   - 1 prono par couple (race, predicteur) → UNIQUE
--   - Le coureur lui-même ne peut pas pronostiquer pour sa propre course
--     (target_time existe déjà pour ça) → trigger BEFORE INSERT/UPDATE
--   - RLS : visible à tout user qui partage une amitié avec le coureur
--     OU avec le prédicteur (et bien sûr aux deux concernés directement).

create table if not exists public.race_pronostics (
  id                uuid primary key default gen_random_uuid(),
  upcoming_race_id  uuid not null references public.upcoming_races(id) on delete cascade,
  predictor_id      uuid not null references public.profiles(id) on delete cascade,
  predicted_time    interval not null,
  comment           text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (upcoming_race_id, predictor_id)
);

create index if not exists race_pronostics_race_idx      on public.race_pronostics(upcoming_race_id);
create index if not exists race_pronostics_predictor_idx on public.race_pronostics(predictor_id);

-- Empêche un user de pronostiquer pour lui-même (le target_time côté
-- upcoming_races joue ce rôle).
create or replace function public.race_pronostics_check_not_self() returns trigger
language plpgsql
as $$
declare
  v_runner_id uuid;
begin
  select user_id into v_runner_id
    from public.upcoming_races
    where id = NEW.upcoming_race_id;
  if v_runner_id is not null and v_runner_id = NEW.predictor_id then
    raise exception 'Cannot create a pronostic on your own race (use upcoming_races.target_time instead)';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_race_pronostics_not_self on public.race_pronostics;
create trigger trg_race_pronostics_not_self
before insert or update on public.race_pronostics
for each row execute function public.race_pronostics_check_not_self();

-- updated_at maintenu à chaque UPDATE
create or replace function public.race_pronostics_touch_updated_at() returns trigger
language plpgsql
as $$
begin
  NEW.updated_at = now();
  return NEW;
end;
$$;

drop trigger if exists trg_race_pronostics_touch on public.race_pronostics;
create trigger trg_race_pronostics_touch
before update on public.race_pronostics
for each row execute function public.race_pronostics_touch_updated_at();

alter table public.race_pronostics enable row level security;

-- SELECT : self (predictor), coureur de la course, ami du predictor,
-- ou ami du coureur. Tous les autres → invisible.
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
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.user_id   = auth.uid() and f.friend_id = race_pronostics.predictor_id)
          or (f.friend_id = auth.uid() and f.user_id   = race_pronostics.predictor_id))
    )
    or exists (
      select 1
      from public.upcoming_races r
      join public.friendships f on (
        (f.user_id   = auth.uid() and f.friend_id = r.user_id)
        or (f.friend_id = auth.uid() and f.user_id   = r.user_id)
      )
      where r.id = race_pronostics.upcoming_race_id
        and f.status = 'accepted'
    )
  );

drop policy if exists "race_pronostics_insert" on public.race_pronostics;
create policy "race_pronostics_insert" on public.race_pronostics
  for insert with check (predictor_id = auth.uid());

drop policy if exists "race_pronostics_update" on public.race_pronostics;
create policy "race_pronostics_update" on public.race_pronostics
  for update using (predictor_id = auth.uid());

drop policy if exists "race_pronostics_delete" on public.race_pronostics;
create policy "race_pronostics_delete" on public.race_pronostics
  for delete using (predictor_id = auth.uid());

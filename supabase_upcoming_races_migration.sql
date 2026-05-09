-- ── upcoming_races — déclaration de courses à venir ──────────────────────
--
-- Première brique des pronostics entre amis (sem 7-8 du roadmap). Cette
-- migration ne crée que la table + RLS ; les pronos eux-mêmes et les
-- notifications de "nouvelle course déclarée" arriveront après.
--
-- Note RLS : la table d'amitiés du projet s'appelle bien `friendships`
-- (storage bidirectionnel : 1 row par direction, donc un check `OR` suffit
-- pour couvrir les 2 cas).

create table if not exists public.upcoming_races (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  race_name    text not null,
  race_date    date not null,
  discipline   text not null check (discipline in ('run','trail','tri','hyrox')),
  distance_km  numeric not null,
  target_time  interval,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists upcoming_races_user_idx on public.upcoming_races(user_id);
create index if not exists upcoming_races_date_idx on public.upcoming_races(race_date);

alter table public.upcoming_races enable row level security;

drop policy if exists "upcoming_races_select_friends" on public.upcoming_races;
create policy "upcoming_races_select_friends" on public.upcoming_races
  for select using (
    auth.uid() = user_id
    or exists (
      select 1 from public.friendships
      where (friendships.user_id   = auth.uid() and friendships.friend_id = upcoming_races.user_id)
         or (friendships.friend_id = auth.uid() and friendships.user_id   = upcoming_races.user_id)
    )
  );

drop policy if exists "upcoming_races_insert_self" on public.upcoming_races;
create policy "upcoming_races_insert_self" on public.upcoming_races
  for insert with check (auth.uid() = user_id);

drop policy if exists "upcoming_races_update_self" on public.upcoming_races;
create policy "upcoming_races_update_self" on public.upcoming_races
  for update using (auth.uid() = user_id);

drop policy if exists "upcoming_races_delete_self" on public.upcoming_races;
create policy "upcoming_races_delete_self" on public.upcoming_races
  for delete using (auth.uid() = user_id);

-- Trigger pour maintenir updated_at à chaque UPDATE.
create or replace function public.upcoming_races_touch_updated_at() returns trigger
language plpgsql
as $$
begin
  NEW.updated_at = now();
  return NEW;
end;
$$;

drop trigger if exists trg_upcoming_races_touch on public.upcoming_races;
create trigger trg_upcoming_races_touch
before update on public.upcoming_races
for each row execute function public.upcoming_races_touch_updated_at();

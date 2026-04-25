-- ────────────────────────────────────────────────────────────────────────────
-- PaceRank — système de ligues hebdomadaires (user_leagues)
-- À exécuter une seule fois dans Supabase → SQL Editor
-- ────────────────────────────────────────────────────────────────────────────

-- 1. Enum des paliers de ligue
do $$ begin
  if not exists (select 1 from pg_type where typname = 'league_tier') then
    create type league_tier as enum ('bronze','silver','gold','diamond','elite');
  end if;
end $$;

-- 2. Table user_leagues
create table if not exists public.user_leagues (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  current_league   league_tier not null default 'bronze',
  league_group_id  uuid,
  week_start_date  date not null default (date_trunc('week', (now() at time zone 'Europe/Paris')))::date,
  week_points      integer not null default 0,
  updated_at       timestamptz not null default now()
);

create index if not exists user_leagues_tier_idx on public.user_leagues(current_league);
create index if not exists user_leagues_group_idx on public.user_leagues(league_group_id);

-- 3. Row Level Security
alter table public.user_leagues enable row level security;

drop policy if exists "user_leagues_select_all" on public.user_leagues;
create policy "user_leagues_select_all" on public.user_leagues
  for select using (true);

drop policy if exists "user_leagues_insert_self" on public.user_leagues;
create policy "user_leagues_insert_self" on public.user_leagues
  for insert with check (auth.uid() = user_id);

drop policy if exists "user_leagues_update_self" on public.user_leagues;
create policy "user_leagues_update_self" on public.user_leagues
  for update using (auth.uid() = user_id);

-- 4. Auto-création de la ligue pour les nouveaux profils (Bronze par défaut)
create or replace function public.ensure_user_league() returns trigger as $$
begin
  insert into public.user_leagues (user_id, current_league)
  values (new.id, 'bronze')
  on conflict (user_id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_ensure_user_league on public.profiles;
create trigger trg_ensure_user_league
  after insert on public.profiles
  for each row execute function public.ensure_user_league();

-- 5. Backfill : créer une ligue Bronze pour les profils existants
insert into public.user_leagues (user_id, current_league)
select p.id, 'bronze'::league_tier
from public.profiles p
left join public.user_leagues ul on ul.user_id = p.id
where ul.user_id is null;

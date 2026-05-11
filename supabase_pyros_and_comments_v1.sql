-- Tables sociales : pyros (likes) + comments + helper is_user_on_fire
-- Appliquée le 2026-05-11 sur PaceRank (mmiezguttefoknaizmbs)
-- via Supabase MCP, migration: pyros_and_comments_v2_generic
--
-- Tables génériques (activity_type + activity_id) pour couvrir results ET trainings.
-- Backfill depuis activity_likes / activity_comments (anciennes tables).

drop table if exists public.pyros cascade;
drop table if exists public.comments cascade;

-- ── PYROS ─────────────────────────────────────────────────────────────────────
create table public.pyros (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  activity_type text not null check (activity_type in ('result','training')),
  activity_id uuid not null,
  created_at timestamptz not null default now(),
  unique(user_id, activity_type, activity_id)
);

create index pyros_activity_idx on public.pyros(activity_type, activity_id);
create index pyros_user_idx on public.pyros(user_id);
create index pyros_recent_idx on public.pyros(created_at desc);

alter table public.pyros enable row level security;

create policy "pyros_select_all" on public.pyros
  for select using (auth.uid() is not null);
create policy "pyros_insert_self" on public.pyros
  for insert with check (auth.uid() = user_id);
create policy "pyros_delete_self" on public.pyros
  for delete using (auth.uid() = user_id);

-- ── COMMENTS ──────────────────────────────────────────────────────────────────
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  activity_type text not null check (activity_type in ('result','training')),
  activity_id uuid not null,
  content text not null check (length(content) > 0 and length(content) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index comments_activity_idx on public.comments(activity_type, activity_id, created_at);
create index comments_user_idx on public.comments(user_id);

alter table public.comments enable row level security;

create policy "comments_select_all" on public.comments
  for select using (auth.uid() is not null);
create policy "comments_insert_self" on public.comments
  for insert with check (auth.uid() = user_id);
create policy "comments_update_self" on public.comments
  for update using (auth.uid() = user_id);
create policy "comments_delete_self" on public.comments
  for delete using (auth.uid() = user_id);

create or replace function public._comments_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_comments_touch_updated_at
  before update on public.comments
  for each row execute function public._comments_touch_updated_at();

-- ── BACKFILL depuis activity_likes / activity_comments ────────────────────────
insert into public.pyros(user_id, activity_type, activity_id, created_at)
select user_id, activity_type, activity_id, coalesce(created_at, now())
from public.activity_likes
on conflict (user_id, activity_type, activity_id) do nothing;

insert into public.comments(user_id, activity_type, activity_id, content, created_at, updated_at)
select user_id, activity_type, activity_id, content, coalesce(created_at, now()), coalesce(created_at, now())
from public.activity_comments
where length(content) > 0 and length(content) <= 500;

-- ── EN FEU ────────────────────────────────────────────────────────────────────
-- Renvoie true si l'user a reçu ≥15 pyros sur ses activités dans les 24 dernières heures.
create or replace function public.is_user_on_fire(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select count(*) >= 15
  from public.pyros p
  where p.created_at >= now() - interval '24 hours'
    and (
      (p.activity_type = 'result' and exists (
        select 1 from public.results r
        where r.id = p.activity_id and r.user_id = p_user_id))
      or
      (p.activity_type = 'training' and exists (
        select 1 from public.trainings t
        where t.id = p.activity_id and t.user_id = p_user_id))
    );
$$;

grant execute on function public.is_user_on_fire(uuid) to authenticated;

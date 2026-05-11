-- Tables sociales V1 : pyros (likes) + comments + helper is_user_on_fire
-- Appliquée le 2026-05-11 sur PaceRank (mmiezguttefoknaizmbs)
-- via Supabase MCP, migration: pyros_and_comments_v1

-- ── PYROS ─────────────────────────────────────────────────────────────────────
create table if not exists public.pyros (
  id uuid primary key default gen_random_uuid(),
  result_id uuid not null references public.results(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(result_id, user_id)
);

create index if not exists pyros_result_idx on public.pyros(result_id);
create index if not exists pyros_user_idx on public.pyros(user_id);
create index if not exists pyros_recent_idx on public.pyros(created_at desc);

alter table public.pyros enable row level security;

drop policy if exists "pyros_select_all" on public.pyros;
create policy "pyros_select_all" on public.pyros
  for select using (auth.uid() is not null);

drop policy if exists "pyros_insert_self" on public.pyros;
create policy "pyros_insert_self" on public.pyros
  for insert with check (auth.uid() = user_id);

drop policy if exists "pyros_delete_self" on public.pyros;
create policy "pyros_delete_self" on public.pyros
  for delete using (auth.uid() = user_id);

-- ── COMMENTS ──────────────────────────────────────────────────────────────────
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  result_id uuid not null references public.results(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (length(content) > 0 and length(content) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists comments_result_idx on public.comments(result_id, created_at);
create index if not exists comments_user_idx on public.comments(user_id);

alter table public.comments enable row level security;

drop policy if exists "comments_select_all" on public.comments;
create policy "comments_select_all" on public.comments
  for select using (auth.uid() is not null);

drop policy if exists "comments_insert_self" on public.comments;
create policy "comments_insert_self" on public.comments
  for insert with check (auth.uid() = user_id);

drop policy if exists "comments_update_self" on public.comments;
create policy "comments_update_self" on public.comments
  for update using (auth.uid() = user_id);

drop policy if exists "comments_delete_self" on public.comments;
create policy "comments_delete_self" on public.comments
  for delete using (auth.uid() = user_id);

-- Trigger updated_at sur comments
create or replace function public._comments_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_comments_touch_updated_at on public.comments;
create trigger trg_comments_touch_updated_at
  before update on public.comments
  for each row execute function public._comments_touch_updated_at();

-- ── EN FEU ────────────────────────────────────────────────────────────────────
-- Renvoie true si l'user a reçu ≥15 pyros sur ses results dans les dernières 24h.
create or replace function public.is_user_on_fire(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select count(*) >= 15
  from public.pyros p
  join public.results r on r.id = p.result_id
  where r.user_id = p_user_id
    and p.created_at >= now() - interval '24 hours';
$$;

grant execute on function public.is_user_on_fire(uuid) to authenticated;

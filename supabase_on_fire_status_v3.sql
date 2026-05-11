-- Statut EN FEU v3 : table d'état + table d'historique des prolongations.
-- Appliquée le 2026-05-12 sur PaceRank (mmiezguttefoknaizmbs)
-- via Supabase MCP, migration: on_fire_status_v3_tables
--
-- Logique :
-- - Activation quand 8 pyros sur 24h glissantes sur l'ensemble des activités.
-- - Statut actif pour 72h fixes à partir de l'activation.
-- - Prolongation possible : si une AUTRE activité (course OU training) dans
--   la fenêtre atteint 8 pyros avant expiration → +72h à partir de ce moment.
-- - Chaque activité ne peut prolonger qu'une seule fois (anti-spam).

-- ── État actuel du user ──────────────────────────────────────────────────────
create table if not exists public.user_on_fire_status (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  activated_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_on_fire_expires_idx
  on public.user_on_fire_status(expires_at);

alter table public.user_on_fire_status enable row level security;

drop policy if exists "user_on_fire_select_all" on public.user_on_fire_status;
create policy "user_on_fire_select_all" on public.user_on_fire_status
  for select using (auth.uid() is not null);

-- ── Historique anti-double-prolongation ──────────────────────────────────────
create table if not exists public.on_fire_extensions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  activity_type text not null check (activity_type in ('result','training')),
  activity_id uuid not null,
  extended_at timestamptz not null default now(),
  unique(user_id, activity_type, activity_id)
);

create index if not exists on_fire_extensions_user_idx
  on public.on_fire_extensions(user_id);

alter table public.on_fire_extensions enable row level security;

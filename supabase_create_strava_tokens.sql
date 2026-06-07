-- Table strava_tokens : stocke les tokens OAuth Strava côté serveur pour
-- que la fonction webhook (/api/strava/webhook) puisse retrouver le user
-- Pacerank correspondant à un athlete_id Strava reçu en notification.
--
-- Appliqué le 2026-05-22 via MCP (migration create_strava_tokens_table).
--
-- Avant : tokens stockés en localStorage (client uniquement) → webhook
-- ne pouvait pas savoir qui est qui.

create table if not exists public.strava_tokens (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  athlete_id bigint not null unique,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_strava_tokens_athlete_id
  on public.strava_tokens(athlete_id);

alter table public.strava_tokens enable row level security;

drop policy if exists strava_tokens_select_own on public.strava_tokens;
create policy strava_tokens_select_own on public.strava_tokens
  for select using (user_id = auth.uid());

drop policy if exists strava_tokens_insert_own on public.strava_tokens;
create policy strava_tokens_insert_own on public.strava_tokens
  for insert with check (user_id = auth.uid());

drop policy if exists strava_tokens_update_own on public.strava_tokens;
create policy strava_tokens_update_own on public.strava_tokens
  for update using (user_id = auth.uid());

drop policy if exists strava_tokens_delete_own on public.strava_tokens;
create policy strava_tokens_delete_own on public.strava_tokens
  for delete using (user_id = auth.uid());

create or replace function public._strava_tokens_touch_updated_at()
returns trigger language plpgsql set search_path = public, pg_catalog as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_strava_tokens_updated_at on public.strava_tokens;
create trigger trg_strava_tokens_updated_at
  before update on public.strava_tokens
  for each row execute function public._strava_tokens_touch_updated_at();

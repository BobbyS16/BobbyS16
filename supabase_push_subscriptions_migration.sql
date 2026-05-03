-- ────────────────────────────────────────────────────────────────────────────
-- PaceRank — table push_subscriptions (OneSignal player IDs par utilisateur)
-- À exécuter une seule fois dans Supabase → SQL Editor
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.push_subscriptions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles(id) on delete cascade,
  onesignal_player_id text not null,
  subscribed_at       timestamptz not null default now(),
  last_seen           timestamptz not null default now(),
  active              boolean not null default true,
  unique (user_id, onesignal_player_id)
);

create index if not exists push_subs_user_idx   on public.push_subscriptions(user_id);
create index if not exists push_subs_active_idx on public.push_subscriptions(active);

-- Row Level Security : un user ne voit/modifie que ses propres subscriptions
alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subs_select_self" on public.push_subscriptions;
create policy "push_subs_select_self" on public.push_subscriptions
  for select using (auth.uid() = user_id);

drop policy if exists "push_subs_insert_self" on public.push_subscriptions;
create policy "push_subs_insert_self" on public.push_subscriptions
  for insert with check (auth.uid() = user_id);

drop policy if exists "push_subs_update_self" on public.push_subscriptions;
create policy "push_subs_update_self" on public.push_subscriptions
  for update using (auth.uid() = user_id);

drop policy if exists "push_subs_delete_self" on public.push_subscriptions;
create policy "push_subs_delete_self" on public.push_subscriptions
  for delete using (auth.uid() = user_id);

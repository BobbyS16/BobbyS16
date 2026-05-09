-- ── PaceRank Groups v1 — DROP + CREATE clean ──────────────────────────────
--
-- Les tables `groups` et `group_members` existaient déjà mais avec un
-- schéma minimal (groups: id/name/code/created_by/created_at, members:
-- id/group_id/user_id/joined_at). Aucune row en prod, donc on repart
-- propre avec le schéma cible (description, city, discipline, is_public,
-- join_code, role).

drop table if exists public.group_members cascade;
drop table if exists public.groups cascade;

create table public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  city        text,
  discipline  text not null default 'all'
              check (discipline in ('all','run','tri','trail','hyrox')),
  is_public   boolean not null default false,
  join_code   text unique,
  created_by  uuid not null references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table public.group_members (
  id        uuid primary key default gen_random_uuid(),
  group_id  uuid not null references public.groups(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  role      text not null default 'member' check (role in ('admin','member')),
  joined_at timestamptz not null default now(),
  unique (group_id, user_id)
);

create index idx_group_members_user on public.group_members (user_id);
create index idx_group_members_group on public.group_members (group_id);
create index idx_groups_join_code on public.groups (join_code) where join_code is not null;
create index idx_groups_public on public.groups (is_public) where is_public = true;

alter table public.groups enable row level security;
alter table public.group_members enable row level security;

-- groups: SELECT visible si is_public OR membership
create policy groups_select on public.groups for select using (
  is_public = true
  or exists (
    select 1 from public.group_members gm
    where gm.group_id = groups.id and gm.user_id = auth.uid()
  )
);

-- groups: INSERT par auth.uid() (il devient created_by)
create policy groups_insert on public.groups for insert with check (
  auth.uid() = created_by
);

-- groups: UPDATE/DELETE réservé aux admins du groupe
create policy groups_update on public.groups for update using (
  exists (
    select 1 from public.group_members gm
    where gm.group_id = groups.id
      and gm.user_id  = auth.uid()
      and gm.role     = 'admin'
  )
);
create policy groups_delete on public.groups for delete using (
  exists (
    select 1 from public.group_members gm
    where gm.group_id = groups.id
      and gm.user_id  = auth.uid()
      and gm.role     = 'admin'
  )
);

-- group_members: SELECT visible si je suis membre du même groupe
create policy group_members_select on public.group_members for select using (
  exists (
    select 1 from public.group_members me
    where me.group_id = group_members.group_id
      and me.user_id  = auth.uid()
  )
);

-- group_members: INSERT (rejoindre) — soit groupe public, soit le user crée
-- son propre row de membership pour lui-même (auth.uid()). Le code
-- d'invitation est vérifié côté client (lookup join_code → group_id).
create policy group_members_insert on public.group_members for insert with check (
  user_id = auth.uid()
  and (
    exists (select 1 from public.groups g where g.id = group_members.group_id and g.is_public = true)
    or exists (select 1 from public.groups g where g.id = group_members.group_id and g.join_code is not null)
    or exists (select 1 from public.group_members gm
               where gm.group_id = group_members.group_id and gm.user_id = auth.uid())
  )
);

-- group_members: DELETE — self-leave OU admin retire qqn
create policy group_members_delete on public.group_members for delete using (
  user_id = auth.uid()
  or exists (
    select 1 from public.group_members admin
    where admin.group_id = group_members.group_id
      and admin.user_id  = auth.uid()
      and admin.role     = 'admin'
  )
);

-- Trigger : à la création d'un groupe, créer automatiquement le row
-- group_members pour le created_by avec role='admin'. Évite un round-trip
-- côté client après le INSERT du groupe.
create or replace function public.groups_add_creator_as_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.group_members (group_id, user_id, role)
  values (NEW.id, NEW.created_by, 'admin')
  on conflict (group_id, user_id) do nothing;
  return NEW;
end;
$$;

drop trigger if exists trg_groups_add_creator_as_admin on public.groups;
create trigger trg_groups_add_creator_as_admin
after insert on public.groups
for each row execute function public.groups_add_creator_as_admin();

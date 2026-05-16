-- Fix RLS récursive sur group_members — appliqué le 2026-05-16 via MCP
-- Migration "fix_group_members_rls_recursion".
--
-- Bug : les policies group_members_select et group_members_delete
-- contenaient un EXISTS(SELECT FROM group_members ...) qui auto-référence
-- la table protégée → Postgres détecte infinite recursion in policy →
-- erreur 500 sur tous les appels REST authentifiés (ex: loadMyGroups
-- côté front pour afficher l'onglet Crew sur Home).
--
-- Cause : les policies "voir les members du groupe où je suis" et
-- "supprimer si je suis admin" ont besoin de vérifier l'appartenance via
-- group_members, ce qui re-déclenche la policy → boucle.
--
-- Fix : déléguer le check à 2 fonctions SECURITY DEFINER qui bypass RLS
-- dans le query interne. Pas de récursion. La sémantique reste identique.

create or replace function public.is_member_of_group(p_group_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from group_members
    where group_id = p_group_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_admin_of_group(p_group_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from group_members
    where group_id = p_group_id and user_id = auth.uid() and role = 'admin'
  );
$$;

drop policy if exists group_members_select on public.group_members;
create policy group_members_select on public.group_members
  for select
  using (public.is_member_of_group(group_id));

drop policy if exists group_members_delete on public.group_members;
create policy group_members_delete on public.group_members
  for delete
  using (user_id = auth.uid() or public.is_admin_of_group(group_id));

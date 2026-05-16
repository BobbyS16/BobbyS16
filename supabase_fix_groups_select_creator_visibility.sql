-- Fix groups_select pour visibilité créateur — appliqué le 2026-05-16 via MCP
-- Migration "fix_groups_select_creator_visibility".
--
-- Bug : la création d'un groupe PRIVÉ via PostgREST échouait avec
-- "new row violates row-level security policy for table groups" (403).
-- Les groupes publics passaient sans souci.
--
-- Cause :
--   - L'appel JS est `supabase.from("groups").insert(...).select().single()`
--     → PostgREST génère un INSERT ... RETURNING.
--   - PostgreSQL applique la policy SELECT au RETURNING (pour les colonnes
--     renvoyées). Si elle échoue, l'erreur retournée est le générique
--     "new row violates row-level security policy" (par sécurité, pour ne
--     pas leaker l'info).
--   - La policy groups_select existante exigeait soit `is_public = true`,
--     soit `EXISTS (SELECT FROM group_members WHERE ...)`. Pour un groupe
--     privé fraîchement créé, le trigger `groups_add_creator_as_admin`
--     ajoute bien le créateur dans group_members APRÈS l'INSERT, mais le
--     EXISTS dans le RETURNING utilise notre fonction `is_member_of_group()`
--     marquée STABLE → Postgres peut cacher son résultat dans la même
--     query, ce qui crée un risque de timing (résultat évalué avant que
--     le trigger fasse son insert dans group_members).
--
-- Fix : ajouter `created_by = auth.uid()` à groups_select. Le créateur
-- voit toujours son groupe directement via cette clause, sans dépendre
-- du timing trigger/cache. Comportement utilisateur identique pour les
-- autres (groupes publics visibles par tous, groupes privés visibles
-- pour les membres).

drop policy if exists groups_select on public.groups;
create policy groups_select on public.groups
  for select
  using (
    is_public = true
    or created_by = auth.uid()
    or exists (
      select 1 from group_members gm
      where gm.group_id = groups.id and gm.user_id = auth.uid()
    )
  );

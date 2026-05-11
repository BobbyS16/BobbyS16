-- RPC batch pour précharger le statut EN FEU de plusieurs users en une requête.
-- Appliquée le 2026-05-11 sur PaceRank (mmiezguttefoknaizmbs)
-- via Supabase MCP, migration: users_on_fire_batch
--
-- Renvoie uniquement les user_ids ayant >=15 pyros sur leurs activités dans
-- les 24 dernières heures. Pour Étape 5 du brief Pyros (badge EN FEU).

create or replace function public.users_on_fire(p_user_ids uuid[])
returns table (user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select t.user_id
  from (
    select
      coalesce(r.user_id, tr.user_id) as user_id
    from public.pyros p
    left join public.results   r  on p.activity_type = 'result'   and r.id  = p.activity_id
    left join public.trainings tr on p.activity_type = 'training' and tr.id = p.activity_id
    where p.created_at >= now() - interval '24 hours'
      and coalesce(r.user_id, tr.user_id) = any(p_user_ids)
  ) t
  group by t.user_id
  having count(*) >= 8;
$$;

grant execute on function public.users_on_fire(uuid[]) to authenticated;

-- Décale le cron weekly_recap du dimanche 17h UTC au lundi 7h UTC
-- (8h Paris hiver / 9h Paris été). Appliqué le 2026-05-18 via MCP.
--
-- Avant : le bilan était envoyé dimanche en cours de journée, donc les
-- sessions du dimanche soir n'étaient pas comptées. L'user devait avoir
-- fini sa journée sportive avant 17h pour que ça s'affiche correctement.
--
-- Après : le cron tourne lundi matin (la semaine est forcément finie). La
-- fonction calcule la dernière semaine complète (lundi → dimanche
-- précédents) via isodow plutôt que de prendre la semaine "courante".

select cron.unschedule('weekly_recap_run');
select cron.schedule('weekly_recap_run', '0 7 * * 1', 'select public.notify_weekly_recap_run();');

create or replace function public.notify_weekly_recap_run()
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_week_start date;
  v_week_end   date;
begin
  -- Dernière semaine COMPLÈTE. isodow : lundi=1, ..., dimanche=7.
  -- Lundi matin → v_week_end = today - 1 = dimanche d'hier. v_week_start = lundi d'avant.
  v_week_end := current_date - extract(isodow from current_date)::int;
  v_week_start := v_week_end - 6;

  with active_users as (
    select
      t.user_id,
      count(*)         as sessions_count,
      sum(t.distance)  as total_km,
      sum(t.points)    as points_gained
    from trainings t
    where t.date between v_week_start and v_week_end
    group by t.user_id
  ),
  recap as (
    select
      au.user_id,
      au.sessions_count,
      au.total_km,
      au.points_gained,
      1 + (
        select count(*)
        from friendships f
        left join active_users au2 on au2.user_id = f.friend_id
        where f.user_id = au.user_id
          and f.status  = 'accepted'
          and coalesce(au2.points_gained, 0) > au.points_gained
      ) as friends_rank
    from active_users au
  )
  insert into notifications (user_id, type, activity_type, payload)
  select
    r.user_id,
    'weekly_recap',
    'weekly_recap',
    jsonb_build_object(
      'sessions_count', r.sessions_count,
      'total_km',       r.total_km,
      'points_gained',  r.points_gained,
      'friends_rank',   r.friends_rank,
      'week_start',     v_week_start::text,
      'week_end',       v_week_end::text
    )
  from recap r
  where not exists (
    select 1 from notifications n
    where n.type = 'weekly_recap'
      and n.user_id = r.user_id
      and n.payload->>'week_start' = v_week_start::text
  );
end;
$function$;

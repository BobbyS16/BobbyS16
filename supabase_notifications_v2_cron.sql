-- ── notifications v2 — pg_cron jobs (recap hebdo + comeback) ─────────────
--
-- Étape 2 du pipeline notifs, types 7 et 8 du brief. Deux jobs pg_cron
-- qui insèrent des rows dans la table notifications selon une fenêtre
-- temporelle. Idempotents : un re-run du même job (même jour/semaine)
-- ne crée pas de doublon grâce aux gardes NOT EXISTS.
--
-- Le pipeline existant (trigger pg_net AFTER INSERT notifications →
-- /api/notifs/push-pending) prend ensuite en charge l'envoi OneSignal.

-- ── 7. weekly_recap ──────────────────────────────────────────────────────
-- Dimanche 17:00 UTC. Pour chaque user avec ≥1 training dans la semaine
-- en cours (lundi → dimanche, dates ISO), insère 1 notif récap avec :
--   - sessions_count, total_km, points_gained de la semaine
--   - friends_rank parmi le user + ses amis acceptés (1 = meilleur),
--     amis inactifs comptés à 0 pt → permet l'UX "3e sur 8 amis"
-- Idempotence : NOT EXISTS sur (type='weekly_recap', user_id, week_start).

create or replace function notify_weekly_recap_run() returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week_start date;
  v_week_end   date;
begin
  -- Lundi de la semaine du run (le run lui-même est dimanche 17h UTC,
  -- donc cette expression revient le lundi qui précède directement).
  v_week_start := current_date - (extract(isodow from current_date)::int - 1);
  v_week_end   := v_week_start + 6;

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
$$;

select cron.schedule(
  'weekly_recap_run',
  '0 17 * * 0',
  $$select public.notify_weekly_recap_run();$$
);

-- ── 8. comeback ──────────────────────────────────────────────────────────
-- Tous les jours 16:00 UTC. Pour chaque user dont la dernière activité
-- (max entre trainings.date et results.race_date) est entre 7 et 30 jours
-- avant aujourd'hui (inclus), insère 1 notif comeback.
-- Skip si une notif comeback existe déjà pour ce user dans les 30 derniers
-- jours → cap d'1 relance par mois.

create or replace function notify_comeback_run() returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  with last_activity as (
    select
      p.id as user_id,
      (select max(t.date)      from trainings t where t.user_id = p.id) as last_training_date,
      (select max(r.race_date) from results   r where r.user_id = p.id) as last_result_date
    from profiles p
  ),
  enriched as (
    select
      la.user_id,
      greatest(
        coalesce(la.last_training_date, '1900-01-01'::date),
        coalesce(la.last_result_date,   '1900-01-01'::date)
      ) as last_activity_date,
      case
        when coalesce(la.last_training_date, '1900-01-01'::date)
           >= coalesce(la.last_result_date,   '1900-01-01'::date)
        then 'training'
        else 'result'
      end as last_activity_type
    from last_activity la
    where la.last_training_date is not null or la.last_result_date is not null
  )
  insert into notifications (user_id, type, activity_type, payload)
  select
    e.user_id,
    'comeback',
    'comeback',
    jsonb_build_object(
      'days_since_last',   (current_date - e.last_activity_date),
      'last_activity_type', e.last_activity_type
    )
  from enriched e
  where (current_date - e.last_activity_date) between 7 and 30
    and not exists (
      select 1 from notifications n
      where n.type = 'comeback'
        and n.user_id = e.user_id
        and n.created_at > (now() - interval '30 days')
    );
end;
$$;

select cron.schedule(
  'comeback_run',
  '0 16 * * *',
  $$select public.notify_comeback_run();$$
);

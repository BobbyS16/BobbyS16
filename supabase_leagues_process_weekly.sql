-- Système de ligues hebdo (2/4) : table de log + fonction de promotion/relégation.
--
-- À exécuter APRÈS supabase_leagues_get_weekly_points.sql.
-- Migration appliquée sur Supabase prod le 2026-05-13.

-- ─── Table de log (idempotence + debug) ──────────────────────────────────────
create table if not exists public.league_processing_log (
  week_start_date date primary key,
  processed_at    timestamptz not null default now(),
  summary         jsonb       not null
);

-- ─── Fonction principale ─────────────────────────────────────────────────────
-- Calcule la semaine qui vient de se terminer (lundi semaine-1 Europe/Paris),
-- puis pour chaque ligue (bronze → elite) :
--   1. Snapshot initial des current_league (évite la cascade : un user promu
--      bronze→silver dans l'itération 1 ne réapparait pas comme actif silver
--      dans l'itération 2).
--   2. Collecte les actifs (week_points >= 1).
--   3. Classe par pts DESC, user_id ASC.
--   4. Tailles top/bottom :
--      - n >= 6      → top 3, bottom 3
--      - n == 3,4,5  → top floor(n/2), bottom floor(n/2) (middle stagne pour n=5,3)
--      - n <= 2      → top 1, bottom 0 (pas assez pour relég)
--   5. Étend aux ex-aequo (tous les ex-aequo montent/descendent).
--   6. Promo si pts >= seuil_promo[league]
--      Relég si pts <  seuil_maintien[league]
--      Bronze : pas de relég. Elite : pas de promo.
--   7. Avec les seuils proposés (promo > maintien partout), un user ne peut
--      pas vérifier les deux conditions à la fois.
--
-- Retourne un jsonb avec le détail.
-- Idempotente via league_processing_log (1 entrée par week_start_date).

create or replace function public.process_weekly_league_changes()
returns jsonb
language plpgsql
as $$
declare
  v_now_paris      timestamp := (now() at time zone 'Europe/Paris');
  v_week_start     date      := (date_trunc('week', v_now_paris - interval '7 days'))::date;
  v_leagues        text[]    := array['bronze','silver','gold','diamond','elite'];
  v_next           jsonb     := '{"bronze":"silver","silver":"gold","gold":"diamond","diamond":"elite"}'::jsonb;
  v_prev           jsonb     := '{"silver":"bronze","gold":"silver","diamond":"gold","elite":"diamond"}'::jsonb;
  v_promo_min      jsonb     := '{"bronze":50,"silver":100,"gold":200,"diamond":350}'::jsonb;
  v_retain_min     jsonb     := '{"silver":30,"gold":75,"diamond":150,"elite":250}'::jsonb;
  v_league         text;
  v_n              int;
  v_top_size       int;
  v_bottom_size    int;
  v_promo_threshold int;
  v_retain_threshold int;
  v_top_cut_pts    int;
  v_bottom_cut_pts int;
  v_promo_ids      uuid[];
  v_releg_ids      uuid[];
  v_user_id        uuid;
  v_user_pts       int;
  v_leagues_summary jsonb := '{}'::jsonb;
  v_already        boolean;
begin
  select exists (select 1 from public.league_processing_log where week_start_date = v_week_start)
    into v_already;
  if v_already then
    return jsonb_build_object('status','already_processed','week_start', v_week_start::text);
  end if;

  -- Snapshot initial (anti-cascade)
  drop table if exists tmp_leagues_initial;
  create temporary table tmp_leagues_initial on commit drop as
  select user_id, current_league::text as initial_league
  from public.user_leagues;

  foreach v_league in array v_leagues loop
    drop table if exists tmp_actives;
    create temporary table tmp_actives on commit drop as
    select
      tli.user_id,
      public.get_user_weekly_points(tli.user_id, v_week_start) as pts
    from tmp_leagues_initial tli
    where tli.initial_league = v_league;

    delete from tmp_actives where pts < 1;

    select count(*) into v_n from tmp_actives;

    if v_n = 0 then
      v_leagues_summary := v_leagues_summary || jsonb_build_object(
        v_league, jsonb_build_object('actives',0,'promotions',0,'relegations',0)
      );
      continue;
    end if;

    if v_n >= 6 then
      v_top_size := 3; v_bottom_size := 3;
    elsif v_n <= 2 then
      v_top_size := 1; v_bottom_size := 0;
    else
      v_top_size := v_n / 2; v_bottom_size := v_n / 2;
    end if;

    v_promo_threshold  := (v_promo_min  ->> v_league)::int;
    v_retain_threshold := (v_retain_min ->> v_league)::int;

    select pts into v_top_cut_pts
      from (select pts, row_number() over (order by pts desc, user_id asc) rn from tmp_actives) s
     where rn = v_top_size;

    if v_bottom_size > 0 then
      select pts into v_bottom_cut_pts
        from (select pts, row_number() over (order by pts asc, user_id desc) rn from tmp_actives) s
       where rn = v_bottom_size;
    else
      v_bottom_cut_pts := null;
    end if;

    v_promo_ids := array[]::uuid[];
    if v_next ? v_league and v_promo_threshold is not null then
      select coalesce(array_agg(user_id order by pts desc, user_id asc), array[]::uuid[])
        into v_promo_ids
        from tmp_actives
       where pts >= v_top_cut_pts and pts >= v_promo_threshold;
    end if;

    v_releg_ids := array[]::uuid[];
    if v_prev ? v_league and v_retain_threshold is not null and v_bottom_size > 0 then
      select coalesce(array_agg(user_id order by pts asc, user_id desc), array[]::uuid[])
        into v_releg_ids
        from tmp_actives
       where pts <= v_bottom_cut_pts
         and pts <  v_retain_threshold
         and user_id <> all(v_promo_ids);
    end if;

    if array_length(v_promo_ids,1) > 0 then
      foreach v_user_id in array v_promo_ids loop
        select pts into v_user_pts from tmp_actives where user_id = v_user_id;
        update public.user_leagues
           set current_league = (v_next ->> v_league)::public.league_tier,
               updated_at = now()
         where user_id = v_user_id;
        insert into public.notifications (user_id, type, read, payload)
        values (v_user_id, 'league_promotion', false,
          jsonb_build_object(
            'from_league', v_league,
            'to_league',   v_next ->> v_league,
            'week_start',  v_week_start::text,
            'week_points', v_user_pts
          ));
      end loop;
    end if;

    if array_length(v_releg_ids,1) > 0 then
      foreach v_user_id in array v_releg_ids loop
        select pts into v_user_pts from tmp_actives where user_id = v_user_id;
        update public.user_leagues
           set current_league = (v_prev ->> v_league)::public.league_tier,
               updated_at = now()
         where user_id = v_user_id;
        insert into public.notifications (user_id, type, read, payload)
        values (v_user_id, 'league_relegation', false,
          jsonb_build_object(
            'from_league', v_league,
            'to_league',   v_prev ->> v_league,
            'week_start',  v_week_start::text,
            'week_points', v_user_pts
          ));
      end loop;
    end if;

    v_leagues_summary := v_leagues_summary || jsonb_build_object(
      v_league, jsonb_build_object(
        'actives',     v_n,
        'promotions',  coalesce(array_length(v_promo_ids,1), 0),
        'relegations', coalesce(array_length(v_releg_ids,1), 0)
      )
    );
  end loop;

  insert into public.league_processing_log (week_start_date, summary)
  values (v_week_start, jsonb_build_object(
    'week_start',   v_week_start::text,
    'processed_at', now(),
    'leagues',      v_leagues_summary
  ));

  return jsonb_build_object(
    'status','processed',
    'week_start', v_week_start::text,
    'leagues',    v_leagues_summary
  );
end;
$$;

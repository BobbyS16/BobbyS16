-- Réduction des récompenses pronos pour rééquilibrage avec les autres bonus.
-- Appliqué le 2026-05-18 via MCP (migration update_prono_points_distribution).
--
-- Avant : 200 / 100 / 5
-- Après : 100 / 50  / 5
-- La participation reste à 5 (geste social, pas une vraie récompense).
--
-- Idempotent (CREATE OR REPLACE FUNCTION). Le trigger AFTER INSERT ON results
-- continue à utiliser la même fonction, juste les valeurs des +pts changent.

create or replace function public.distribute_prono_points()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_race       record;
  v_true_time  int;
  v_threshold  int := 30;
  v_prono      record;
  v_exact_n    int;
  v_min_gap    int;
  v_prono_n    int;
  v_owner_name text;
  v_result_d   date;
begin
  if NEW.user_id is null or NEW.time is null then
    return NEW;
  end if;
  v_true_time := NEW.time;
  v_result_d  := coalesce(NEW.race_date, NEW.created_at::date);

  select ur.* into v_race
    from public.upcoming_races ur
   where ur.user_id = NEW.user_id
     and abs(ur.race_date - v_result_d) <= 1
     and (
       (ur.discipline = 'run' and (
         (NEW.discipline = '5km'      and round(ur.distance_km)::int = 5)
      or (NEW.discipline = '10km'     and round(ur.distance_km)::int = 10)
      or (NEW.discipline = 'semi'     and round(ur.distance_km)::int = 21)
      or (NEW.discipline = 'marathon' and round(ur.distance_km)::int = 42)
       ))
       or (ur.discipline = 'trail' and NEW.discipline like 'trail-%')
       or (ur.discipline = 'tri'   and NEW.discipline like 'tri-%')
       or (ur.discipline = 'hyrox' and NEW.discipline like 'hyrox-%')
     )
     and not exists (
       select 1 from public.point_bonuses pb
        where pb.bonus_type in ('prono_exact','prono_closest','prono_participation')
          and (pb.metadata->>'upcoming_race_id')::uuid = ur.id
     )
   order by abs(ur.race_date - v_result_d), ur.created_at
   limit 1;

  if v_race.id is null then
    return NEW;
  end if;

  select count(*) into v_prono_n
    from public.race_pronostics rp
   where rp.upcoming_race_id = v_race.id;
  if v_prono_n = 0 then
    return NEW;
  end if;

  select
    count(*) filter (where abs(extract(epoch from rp.predicted_time)::int - v_true_time) <= v_threshold),
    min(abs(extract(epoch from rp.predicted_time)::int - v_true_time))
    into v_exact_n, v_min_gap
    from public.race_pronostics rp
   where rp.upcoming_race_id = v_race.id;

  select coalesce(p.name, 'un ami') into v_owner_name
    from public.profiles p where p.id = NEW.user_id;

  for v_prono in
    select rp.id, rp.predictor_id, rp.predicted_time,
           abs(extract(epoch from rp.predicted_time)::int - v_true_time) as gap
      from public.race_pronostics rp
     where rp.upcoming_race_id = v_race.id
  loop
    if v_exact_n > 0 and v_prono.gap <= v_threshold then
      insert into public.point_bonuses(user_id, bonus_type, points, metadata)
      values (v_prono.predictor_id, 'prono_exact', 100, jsonb_build_object(
        'upcoming_race_id',       v_race.id,
        'prediction_id',          v_prono.id,
        'predicted_time_seconds', extract(epoch from v_prono.predicted_time)::int,
        'true_time_seconds',      v_true_time,
        'gap_seconds',            v_prono.gap
      ));
      insert into public.notifications(user_id, from_user_id, type, read, payload)
      values (v_prono.predictor_id, NEW.user_id, 'prono_exact', false, jsonb_build_object(
        'upcoming_race_id', v_race.id,
        'race_name',        v_race.race_name,
        'runner_name',      v_owner_name,
        'points',           100,
        'gap_seconds',      v_prono.gap
      ));
    elsif v_exact_n = 0 and v_prono.gap = v_min_gap then
      insert into public.point_bonuses(user_id, bonus_type, points, metadata)
      values (v_prono.predictor_id, 'prono_closest', 50, jsonb_build_object(
        'upcoming_race_id',       v_race.id,
        'prediction_id',          v_prono.id,
        'predicted_time_seconds', extract(epoch from v_prono.predicted_time)::int,
        'true_time_seconds',      v_true_time,
        'gap_seconds',            v_prono.gap
      ));
      insert into public.notifications(user_id, from_user_id, type, read, payload)
      values (v_prono.predictor_id, NEW.user_id, 'prono_closest', false, jsonb_build_object(
        'upcoming_race_id', v_race.id,
        'race_name',        v_race.race_name,
        'runner_name',      v_owner_name,
        'points',           50,
        'gap_seconds',      v_prono.gap
      ));
    else
      insert into public.point_bonuses(user_id, bonus_type, points, metadata)
      values (v_prono.predictor_id, 'prono_participation', 5, jsonb_build_object(
        'upcoming_race_id',       v_race.id,
        'prediction_id',          v_prono.id,
        'predicted_time_seconds', extract(epoch from v_prono.predicted_time)::int,
        'true_time_seconds',      v_true_time,
        'gap_seconds',            v_prono.gap
      ));
      insert into public.notifications(user_id, from_user_id, type, read, payload)
      values (v_prono.predictor_id, NEW.user_id, 'prono_participation', false, jsonb_build_object(
        'upcoming_race_id', v_race.id,
        'race_name',        v_race.race_name,
        'runner_name',      v_owner_name,
        'points',           5,
        'gap_seconds',      v_prono.gap
      ));
    end if;
  end loop;

  return NEW;
end;
$function$;

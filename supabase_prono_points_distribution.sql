-- Distribution automatique des points sur les pronostics post-course.
-- Trigger AFTER INSERT sur results : si le result matche une upcoming_race
-- du même user (même catégorie discipline, distance OK pour run, date ±1j),
-- on attribue les bonus aux pronostiqueurs en fonction de l'écart au temps réel.
--
-- Règles (≤30s = exact) :
--   - ≥1 prono exact     → +200 pts à chaque exact + +5 pts aux autres
--   - aucun exact         → +100 pts au(x) prono(s) le(s) plus proche(s) (ex aequo)
--                           + +5 pts aux autres
--
-- Idempotence : on ne distribue qu'une seule fois par upcoming_race (vérif
-- présence d'un bonus 'prono_*' avec metadata.upcoming_race_id correspondant).
-- Pas de recalcul sur UPDATE de result — uniquement AFTER INSERT.

-- 1. Élargit la CHECK constraint sur point_bonuses.bonus_type
alter table public.point_bonuses drop constraint if exists point_bonuses_bonus_type_check;
alter table public.point_bonuses
  add constraint point_bonuses_bonus_type_check
  check (bonus_type in (
    'signup', 'invitation', 'weekly_streak', 'pr_beaten',
    'prono_exact', 'prono_closest', 'prono_participation'
  ));

-- 2. Fonction trigger
create or replace function public.distribute_prono_points()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

  -- Trouve UNE upcoming_race candidate (limit 1 → pas d'ambiguïté multi-courses
  -- même jour, le 1er match l'emporte). Distance check seulement pour 'run'
  -- (les autres catégories ont des subdistance variables ; on retombe sur
  -- catégorie + date).
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

  -- Précompute exact_count + min_gap
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
      values (v_prono.predictor_id, 'prono_exact', 200, jsonb_build_object(
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
        'points',           200,
        'gap_seconds',      v_prono.gap
      ));
    elsif v_exact_n = 0 and v_prono.gap = v_min_gap then
      insert into public.point_bonuses(user_id, bonus_type, points, metadata)
      values (v_prono.predictor_id, 'prono_closest', 100, jsonb_build_object(
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
        'points',           100,
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
$$;

drop trigger if exists trg_distribute_prono_points on public.results;
create trigger trg_distribute_prono_points
after insert on public.results
for each row execute function public.distribute_prono_points();

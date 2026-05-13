-- Notifs : friend_prono — notifier le coureur quand un ami pronostique sur sa course.
-- Migration appliquée sur Supabase prod le 2026-05-13.
--
-- RÈGLE
-- Destinataire = owner de l'upcoming_race (le coureur). On notifie celui dont
-- la course est l'objet du prono. Pas les amis du predictor (évite spam).
--
-- DÉCLENCHEUR
-- AFTER INSERT sur race_pronostics.
--
-- IDEMPOTENCE
-- NOT EXISTS sur (user_id, type='friend_prono', payload->>'prono_id').
-- Le trigger BEFORE existant trg_race_pronostics_not_self refuse déjà
-- l'auto-prono, mais on garde le check v_owner = predictor pour double-safety.
--
-- PAYLOAD
-- {prono_id, upcoming_race_id, race_name, predicted_time (HH:MM:SS), predictor_name}
-- Pas de predicted_rank (cette colonne n'existe pas dans race_pronostics).

create or replace function public.notify_friend_prono()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_race_name text;
  v_predictor_name text;
  v_predicted_text text;
begin
  select user_id, race_name into v_owner, v_race_name
  from public.upcoming_races
  where id = NEW.upcoming_race_id;

  if v_owner is null or v_owner = NEW.predictor_id then
    return NEW;
  end if;

  v_predictor_name := public._actor_short_name(NEW.predictor_id);
  v_predicted_text := to_char(NEW.predicted_time, 'HH24:MI:SS');

  if exists (
    select 1 from public.notifications
    where user_id = v_owner
      and type = 'friend_prono'
      and payload->>'prono_id' = NEW.id::text
  ) then
    return NEW;
  end if;

  insert into public.notifications (user_id, from_user_id, type, payload, read)
  values (
    v_owner,
    NEW.predictor_id,
    'friend_prono',
    jsonb_build_object(
      'prono_id',         NEW.id::text,
      'upcoming_race_id', NEW.upcoming_race_id::text,
      'race_name',        coalesce(v_race_name, 'ta course'),
      'predicted_time',   v_predicted_text,
      'predictor_name',   coalesce(v_predictor_name, 'Un ami')
    ),
    false
  );

  return NEW;
end;
$$;

drop trigger if exists trg_notify_friend_prono on public.race_pronostics;
create trigger trg_notify_friend_prono
  after insert on public.race_pronostics
  for each row execute function public.notify_friend_prono();

-- ── notifications v2 — auto-generated notifs (business logic triggers) ────
--
-- Étape 2 du pipeline notifs : à chaque event métier (course officielle
-- enregistrée, PR battu, palier franchi…), on insère une row dans la table
-- notifications. Le trigger pg_net déjà en place sur INSERT notifications
-- fire ensuite /api/notifs/push-pending qui pousse via OneSignal.
--
-- Idempotence garantie via NOT EXISTS sur (type, payload->>'training_id',
-- user_id) — un même évènement ne peut générer qu'1 notif par destinataire,
-- même si le trigger fire plusieurs fois (UPDATE successifs, etc.).
--
-- Convention friendships : storage bidirectionnel 2-rows par paire, donc
-- WHERE user_id = NEW.user_id suffit pour récupérer tous les amis directs.

-- ── 1. friend_official_race ───────────────────────────────────────────────
-- Notifie les amis quand un user enregistre une course officielle.
-- Cas couverts :
--   A. INSERT manuel avec is_official_race=true (auto_detected=false)
--   B. UPDATE training existant en course officielle (auto_detected=false)
--   C. (skip) auto_detected_official=true mais classification_status='pending'
--   D. UPDATE classification_status 'pending' → 'classified_as_race'
--      sur un training auto-detected (user a confirmé après coup)

create or replace function notify_friend_official_race() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.is_official_race is not true then
    return NEW;
  end if;

  -- Cas C : auto-détecté non confirmé → on n'envoie rien.
  if NEW.auto_detected_official is true
     and NEW.classification_status <> 'classified_as_race' then
    return NEW;
  end if;

  -- Sur UPDATE : ne fire que si quelque chose de pertinent a changé
  -- (transition is_official_race ou classification_status). Sinon les
  -- updates de points / title / etc. re-déclencheraient inutilement
  -- (le NOT EXISTS dédup de toute façon, mais autant éviter le travail).
  if TG_OP = 'UPDATE'
     and OLD.is_official_race is not distinct from NEW.is_official_race
     and OLD.classification_status is not distinct from NEW.classification_status then
    return NEW;
  end if;

  insert into notifications (user_id, type, from_user_id, activity_type, activity_id, payload)
  select
    f.friend_id,
    'friend_official_race',
    NEW.user_id,
    'training',
    NEW.id,
    jsonb_build_object(
      'training_id',   NEW.id::text,
      'race_name',     NEW.official_race_name,
      'discipline',    NEW.official_race_format,
      'distance_km',   NEW.distance,
      'points_earned', NEW.points
    )
  from friendships f
  where f.user_id = NEW.user_id
    and f.status = 'accepted'
    and not exists (
      select 1 from notifications n
      where n.type = 'friend_official_race'
        and n.payload->>'training_id' = NEW.id::text
        and n.user_id = f.friend_id
    );

  return NEW;
end;
$$;

drop trigger if exists trg_notify_friend_official_race on trainings;
create trigger trg_notify_friend_official_race
after insert or update of is_official_race, classification_status on trainings
for each row execute function notify_friend_official_race();

-- ── 2. friend_pr ──────────────────────────────────────────────────────────
-- Notifie les amis quand un user bat son propre record sur une discipline
-- donnée. Conditions :
--   - Strict text match sur (user_id, discipline)
--   - Au moins 1 résultat antérieur (sinon 1ère course = pas un PR)
--   - NEW.time < min(time des autres results de cette combinaison)
--
-- distance_km est dérivée de la discipline pour les running classics ;
-- null pour trail/triathlon/hyrox dont la distance varie selon l'épreuve
-- réelle (pas stockée en DB).

create or replace function notify_friend_pr() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous_best int;
  v_distance_km   numeric;
begin
  -- Meilleur temps précédent du user sur cette discipline (hors NEW)
  select min(time) into v_previous_best
  from results
  where user_id = NEW.user_id
    and discipline = NEW.discipline
    and id <> NEW.id;

  -- Pas de résultat antérieur → ce n'est pas un PR mais une 1ère course
  if v_previous_best is null then
    return NEW;
  end if;

  -- Pas plus rapide qu'avant → pas un PR
  if NEW.time >= v_previous_best then
    return NEW;
  end if;

  v_distance_km := case NEW.discipline
    when '5km'      then 5
    when '10km'     then 10
    when 'semi'     then 21.1
    when 'marathon' then 42.195
    else null
  end;

  insert into notifications (user_id, type, from_user_id, activity_type, activity_id, payload)
  select
    f.friend_id,
    'friend_pr',
    NEW.user_id,
    'result',
    NEW.id,
    jsonb_build_object(
      'result_id',           NEW.id::text,
      'discipline',          NEW.discipline,
      'distance_km',         v_distance_km,
      'old_time',            v_previous_best,
      'new_time',            NEW.time,
      'improvement_seconds', v_previous_best - NEW.time
    )
  from friendships f
  where f.user_id = NEW.user_id
    and f.status = 'accepted'
    and not exists (
      select 1 from notifications n
      where n.type = 'friend_pr'
        and n.payload->>'result_id' = NEW.id::text
        and n.user_id = f.friend_id
    );

  return NEW;
end;
$$;

drop trigger if exists trg_notify_friend_pr on results;
create trigger trg_notify_friend_pr
after insert on results
for each row execute function notify_friend_pr();

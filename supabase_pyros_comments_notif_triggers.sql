-- Triggers de notifications pour pyros + comments (Étape 4 du brief Pyros).
-- Appliquée le 2026-05-11 sur PaceRank (mmiezguttefoknaizmbs)
-- via Supabase MCP, migration: pyros_comments_notif_triggers
--
-- Réutilise le pipeline existant : INSERT sur notifications → trigger pg_net
-- → endpoint Vercel /api/notifs/push-pending → OneSignal.

create or replace function public._activity_owner(p_type text, p_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case p_type
    when 'result'   then (select user_id from public.results   where id = p_id)
    when 'training' then (select user_id from public.trainings where id = p_id)
    else null
  end;
$$;

create or replace function public._actor_short_name(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(split_part(name, ' ', 1), 'Quelqu''un') from public.profiles where id = p_user_id;
$$;

-- ── pyro reçu ─────────────────────────────────────────────────────────────────
-- Si owner ≠ pyroter, INSERT ou UPDATE (groupage) d'une notif pyro_received.
-- Groupage : si une notif non lue existe pour ce (owner, activity), on update
-- le payload (count++, last_names prepend, replace from_user_id) + bump
-- created_at + reset pushed_at pour relancer le push.
create or replace function public.notify_pyro_received()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_actor_name text;
  v_existing_id uuid;
  v_existing_payload jsonb;
  v_new_names jsonb;
  v_new_count int;
begin
  v_owner := public._activity_owner(NEW.activity_type, NEW.activity_id);
  if v_owner is null or v_owner = NEW.user_id then
    return NEW;
  end if;

  v_actor_name := public._actor_short_name(NEW.user_id);

  select id, payload into v_existing_id, v_existing_payload
  from public.notifications
  where user_id = v_owner
    and type = 'pyro_received'
    and activity_type = NEW.activity_type
    and activity_id = NEW.activity_id
    and read = false
  order by created_at desc
  limit 1;

  if v_existing_id is not null then
    v_new_count := coalesce((v_existing_payload->>'count')::int, 1) + 1;
    v_new_names := coalesce(v_existing_payload->'last_names', '[]'::jsonb);
    v_new_names := jsonb_build_array(to_jsonb(v_actor_name)) || v_new_names;
    if jsonb_array_length(v_new_names) > 5 then
      v_new_names := v_new_names - (jsonb_array_length(v_new_names) - 1);
    end if;
    update public.notifications
    set from_user_id = NEW.user_id,
        payload = jsonb_set(
                    jsonb_set(coalesce(payload, '{}'::jsonb), '{count}', to_jsonb(v_new_count)),
                    '{last_names}', v_new_names),
        created_at = now(),
        pushed_at = null
    where id = v_existing_id;
  else
    insert into public.notifications(user_id, from_user_id, type, activity_type, activity_id, payload)
    values (
      v_owner, NEW.user_id, 'pyro_received', NEW.activity_type, NEW.activity_id,
      jsonb_build_object(
        'count', 1,
        'last_names', jsonb_build_array(v_actor_name),
        'activity_type', NEW.activity_type,
        'activity_id', NEW.activity_id
      )
    );
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_notify_pyro_received on public.pyros;
create trigger trg_notify_pyro_received
  after insert on public.pyros
  for each row execute function public.notify_pyro_received();

-- ── commentaire reçu ──────────────────────────────────────────────────────────
-- INSERT notif pour owner (si owner ≠ commenter) + tous les commenteurs
-- précédents distincts (sauf commenter actuel et owner).
create or replace function public.notify_comment_received()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_actor_name text;
  v_preview text;
  v_targets uuid[];
  v_target uuid;
begin
  v_owner := public._activity_owner(NEW.activity_type, NEW.activity_id);
  v_actor_name := public._actor_short_name(NEW.user_id);
  v_preview := case
    when length(NEW.content) > 80 then substring(NEW.content from 1 for 80) || '…'
    else NEW.content
  end;

  v_targets := ARRAY[]::uuid[];
  if v_owner is not null and v_owner <> NEW.user_id then
    v_targets := array_append(v_targets, v_owner);
  end if;

  for v_target in
    select distinct c.user_id
    from public.comments c
    where c.activity_type = NEW.activity_type
      and c.activity_id = NEW.activity_id
      and c.id <> NEW.id
      and c.user_id <> NEW.user_id
      and c.user_id <> coalesce(v_owner, '00000000-0000-0000-0000-000000000000'::uuid)
  loop
    v_targets := array_append(v_targets, v_target);
  end loop;

  if array_length(v_targets, 1) is null then
    return NEW;
  end if;

  insert into public.notifications(user_id, from_user_id, type, activity_type, activity_id, payload)
  select t, NEW.user_id, 'comment_received', NEW.activity_type, NEW.activity_id,
         jsonb_build_object(
           'commenter_name', v_actor_name,
           'comment_id', NEW.id,
           'preview', v_preview,
           'activity_type', NEW.activity_type,
           'activity_id', NEW.activity_id,
           'is_owner', (t = v_owner)
         )
  from unnest(v_targets) as t;

  return NEW;
end;
$$;

drop trigger if exists trg_notify_comment_received on public.comments;
create trigger trg_notify_comment_received
  after insert on public.comments
  for each row execute function public.notify_comment_received();

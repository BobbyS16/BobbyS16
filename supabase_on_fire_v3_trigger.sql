-- Trigger d'activation/prolongation EN FEU + réécriture des RPCs.
-- Appliquée le 2026-05-12 sur PaceRank (mmiezguttefoknaizmbs)
-- via Supabase MCP, migration: on_fire_v3_trigger_and_rpcs
--
-- Les RPCs publiques is_user_on_fire(uuid) et users_on_fire(uuid[]) passent
-- d'un calcul à la volée (8 pyros/24h via agrégation sur pyros) à un simple
-- SELECT sur user_on_fire_status. Signature inchangée → aucun changement côté
-- front nécessaire.

create or replace function public._activity_date(p_type text, p_id uuid)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select case p_type
    when 'result'   then (select race_date from public.results where id = p_id)
    when 'training' then (select date from public.trainings where id = p_id)
    else null
  end;
$$;

create or replace function public.process_pyro_on_fire()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_status user_on_fire_status%rowtype;
  v_pyros_on_activity int;
  v_recent_total int;
  v_already_extended boolean;
  v_activity_date date;
begin
  v_owner := public._activity_owner(NEW.activity_type, NEW.activity_id);
  if v_owner is null then
    return NEW;
  end if;

  select * into v_status
  from public.user_on_fire_status
  where user_id = v_owner;

  if found and v_status.expires_at > now() then
    -- ─── BRANCHE PROLONGATION ────────────────────────────────────────────
    select count(*) into v_pyros_on_activity
    from public.pyros
    where activity_type = NEW.activity_type and activity_id = NEW.activity_id;

    if v_pyros_on_activity < 8 then
      return NEW;
    end if;

    select exists(
      select 1 from public.on_fire_extensions
      where user_id = v_owner
        and activity_type = NEW.activity_type
        and activity_id = NEW.activity_id
    ) into v_already_extended;

    if v_already_extended then
      return NEW;
    end if;

    v_activity_date := public._activity_date(NEW.activity_type, NEW.activity_id);
    if v_activity_date is null
       or v_activity_date < v_status.activated_at::date
       or v_activity_date >= v_status.expires_at::date then
      return NEW;
    end if;

    update public.user_on_fire_status
    set expires_at = now() + interval '72 hours',
        updated_at = now()
    where user_id = v_owner;

    insert into public.on_fire_extensions(user_id, activity_type, activity_id)
    values (v_owner, NEW.activity_type, NEW.activity_id)
    on conflict do nothing;
  else
    -- ─── BRANCHE ACTIVATION (ou réactivation) ───────────────────────────
    select count(*) into v_recent_total
    from public.pyros p
    where p.created_at >= now() - interval '24 hours'
      and (
        (p.activity_type = 'result' and exists (
          select 1 from public.results r
          where r.id = p.activity_id and r.user_id = v_owner))
        or
        (p.activity_type = 'training' and exists (
          select 1 from public.trainings t
          where t.id = p.activity_id and t.user_id = v_owner))
      );

    if v_recent_total >= 8 then
      insert into public.user_on_fire_status(user_id, activated_at, expires_at)
      values (v_owner, now(), now() + interval '72 hours')
      on conflict (user_id) do update
        set activated_at = excluded.activated_at,
            expires_at = excluded.expires_at,
            updated_at = now();

      delete from public.on_fire_extensions where user_id = v_owner;
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_process_pyro_on_fire on public.pyros;
create trigger trg_process_pyro_on_fire
  after insert on public.pyros
  for each row execute function public.process_pyro_on_fire();

create or replace function public.is_user_on_fire(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.user_on_fire_status
    where user_id = p_user_id and expires_at > now()
  );
$$;

create or replace function public.users_on_fire(p_user_ids uuid[])
returns table (user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select s.user_id
  from public.user_on_fire_status s
  where s.user_id = any(p_user_ids)
    and s.expires_at > now();
$$;

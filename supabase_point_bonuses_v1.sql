-- ── point_bonuses — système de bonus de points ────────────────────────────
-- 5 types de bonus :
--   signup        +5 pts (1×/user)        — création du profil
--   profile_photo +5 pts (1×/user)        — quand profile.avatar passe NULL → set
--   invitation    +5 pts par filleul       — au signup d'un user avec referrer_id
--   weekly_streak +5 pts par semaine       — cron lundi 00:05 UTC, ≥2 sem. actives
--   pr_beaten     +20 pts par PR battu    — trigger AFTER INSERT sur results
--
-- Idempotence :
--   - signup / profile_photo : index partiels uniques + ON CONFLICT DO NOTHING
--   - pr_beaten : exige ≥1 résultat antérieur sur la même discipline ET
--                 NEW.time < min(time) des précédents
--
-- RLS : SELECT autorisé à soi + amis. INSERT non autorisé via le client.
-- Les triggers sont SECURITY DEFINER, propriétaire postgres → bypass RLS.

-- 1. Colonne referrer_id sur profiles
alter table public.profiles
  add column if not exists referrer_id uuid references public.profiles(id) on delete set null;

-- 2. Table point_bonuses
create table if not exists public.point_bonuses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  bonus_type text not null check (bonus_type in (
    'signup', 'profile_photo', 'invitation', 'weekly_streak', 'pr_beaten'
  )),
  points integer not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists point_bonuses_user_idx on public.point_bonuses(user_id);
create index if not exists point_bonuses_type_idx on public.point_bonuses(bonus_type);

-- Idempotence pour signup / profile_photo : 1 seule row par user
create unique index if not exists point_bonuses_signup_unique
  on public.point_bonuses(user_id) where bonus_type = 'signup';
create unique index if not exists point_bonuses_photo_unique
  on public.point_bonuses(user_id) where bonus_type = 'profile_photo';
-- Idempotence parrainage : un seul bonus invitation par paire (parrain, filleul)
create unique index if not exists point_bonuses_invitation_unique
  on public.point_bonuses (user_id, (metadata->>'invited_user_id'))
  where bonus_type = 'invitation';

alter table public.point_bonuses enable row level security;

drop policy if exists "point_bonuses_select_own" on public.point_bonuses;
create policy "point_bonuses_select_own" on public.point_bonuses
  for select using (auth.uid() = user_id);

drop policy if exists "point_bonuses_select_friends" on public.point_bonuses;
create policy "point_bonuses_select_friends" on public.point_bonuses
  for select using (
    exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.user_id = auth.uid() and f.friend_id = point_bonuses.user_id)
          or (f.friend_id = auth.uid() and f.user_id = point_bonuses.user_id))
    )
  );

-- 3. Triggers : signup + invitation (lors d'un INSERT sur profiles)
create or replace function public.award_signup_and_invitation_bonuses()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referral_count int;
begin
  insert into public.point_bonuses(user_id, bonus_type, points)
  values (NEW.id, 'signup', 5)
  on conflict do nothing;

  -- Parrainage : ignore le self-referral et plafonne à 5 bonus par parrain
  if NEW.referrer_id is not null and NEW.referrer_id <> NEW.id then
    select count(*) into v_referral_count
    from public.point_bonuses
    where user_id = NEW.referrer_id
      and bonus_type = 'invitation';

    if v_referral_count < 5 then
      insert into public.point_bonuses(user_id, bonus_type, points, metadata)
      values (
        NEW.referrer_id,
        'invitation',
        5,
        jsonb_build_object('invited_user_id', NEW.id)
      )
      on conflict do nothing;
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_award_signup_bonus on public.profiles;
create trigger trg_award_signup_bonus
after insert on public.profiles
for each row execute function public.award_signup_and_invitation_bonuses();

-- 4. Trigger : photo de profil (avatar NULL → non-NULL, INSERT ou UPDATE)
create or replace function public.award_photo_bonus()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (TG_OP = 'INSERT' and NEW.avatar is not null)
     or (TG_OP = 'UPDATE' and OLD.avatar is null and NEW.avatar is not null) then
    insert into public.point_bonuses(user_id, bonus_type, points)
    values (NEW.id, 'profile_photo', 5)
    on conflict do nothing;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_award_photo_bonus on public.profiles;
create trigger trg_award_photo_bonus
after insert or update of avatar on public.profiles
for each row execute function public.award_photo_bonus();

-- 5. Trigger : PR battu (AFTER INSERT sur results)
create or replace function public.award_pr_bonus()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_prev_best int;
begin
  if NEW.user_id is null or NEW.discipline is null or NEW.time is null then
    return NEW;
  end if;

  select count(*), min(time)
    into v_count, v_prev_best
  from public.results
  where user_id = NEW.user_id
    and discipline = NEW.discipline
    and id <> NEW.id
    and time is not null;

  if v_count >= 1 and NEW.time < v_prev_best then
    insert into public.point_bonuses(user_id, bonus_type, points, metadata)
    values (
      NEW.user_id,
      'pr_beaten',
      20,
      jsonb_build_object(
        'result_id', NEW.id,
        'discipline', NEW.discipline,
        'time_seconds', NEW.time,
        'previous_best_seconds', v_prev_best
      )
    );
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_award_pr_bonus on public.results;
create trigger trg_award_pr_bonus
after insert on public.results
for each row execute function public.award_pr_bonus();

-- 6. Weekly streak (cron lundi 00:05 UTC)
create or replace function public.award_weekly_streaks()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last_week_start date;
  v_last_week_end date;
  v_user record;
  v_streak int;
  v_check_week date;
begin
  -- "last week" = la semaine qui vient de se terminer (Mon → Sun, UTC)
  v_last_week_start := (date_trunc('week', now() at time zone 'UTC') - interval '7 days')::date;
  v_last_week_end := v_last_week_start + interval '6 days';

  for v_user in
    select distinct user_id from (
      select user_id from public.trainings
        where date between v_last_week_start and v_last_week_end and user_id is not null
      union
      select user_id from public.results
        where race_date between v_last_week_start and v_last_week_end and user_id is not null
    ) t
  loop
    -- Streak en cours = la semaine d'avant doit aussi être active
    if exists (
      select 1 from public.trainings
       where user_id = v_user.user_id
         and date between v_last_week_start - interval '7 days' and v_last_week_start - interval '1 day'
      union
      select 1 from public.results
       where user_id = v_user.user_id
         and race_date between v_last_week_start - interval '7 days' and v_last_week_start - interval '1 day'
    ) then
      -- Compte la longueur du streak (semaines consécutives actives)
      v_streak := 1;
      v_check_week := v_last_week_start;
      loop
        v_check_week := v_check_week - interval '7 days';
        if exists (
          select 1 from public.trainings
           where user_id = v_user.user_id
             and date between v_check_week and v_check_week + interval '6 days'
          union
          select 1 from public.results
           where user_id = v_user.user_id
             and race_date between v_check_week and v_check_week + interval '6 days'
        ) then
          v_streak := v_streak + 1;
        else
          exit;
        end if;
      end loop;

      insert into public.point_bonuses(user_id, bonus_type, points, metadata)
      values (
        v_user.user_id,
        'weekly_streak',
        5,
        jsonb_build_object('week_start', v_last_week_start, 'streak_length', v_streak)
      );
    end if;
  end loop;
end;
$$;

-- Cron : tous les lundis 00:05 UTC
do $$
begin
  perform cron.unschedule('weekly_streak_bonus');
exception when others then null;
end $$;
select cron.schedule('weekly_streak_bonus', '5 0 * * 1', $$select public.award_weekly_streaks()$$);

-- 7. Backfill rétroactif (signup, photo, PR — pas de streak)
insert into public.point_bonuses(user_id, bonus_type, points)
select id, 'signup', 5 from public.profiles
on conflict do nothing;

insert into public.point_bonuses(user_id, bonus_type, points)
select id, 'profile_photo', 5 from public.profiles where avatar is not null
on conflict do nothing;

with ranked as (
  select
    id, user_id, discipline, time,
    coalesce(race_date, created_at::date) as effective_date,
    created_at,
    row_number() over (
      partition by user_id, discipline
      order by coalesce(race_date, created_at::date), created_at, id
    ) as rn,
    min(time) over (
      partition by user_id, discipline
      order by coalesce(race_date, created_at::date), created_at, id
      rows between unbounded preceding and 1 preceding
    ) as prev_min
  from public.results
  where time is not null and user_id is not null and discipline is not null
)
insert into public.point_bonuses(user_id, bonus_type, points, metadata, created_at)
select
  user_id,
  'pr_beaten',
  20,
  jsonb_build_object(
    'result_id', id,
    'discipline', discipline,
    'time_seconds', time,
    'previous_best_seconds', prev_min,
    'backfilled', true
  ),
  effective_date::timestamptz
from ranked
where rn >= 3 and time < prev_min;

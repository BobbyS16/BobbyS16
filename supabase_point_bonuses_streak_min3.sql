-- weekly_streak v2 : une "semaine active" exige désormais ≥3 entraînements
-- (table trainings). Les courses (results) ne comptent plus comme entraînement
-- pour le calcul du streak. Le bonus reste à +5 pts par semaine active,
-- attribué uniquement si la semaine précédente est aussi ≥3 entraînements.

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
  v_count int;
begin
  v_last_week_start := (date_trunc('week', now() at time zone 'UTC') - interval '7 days')::date;
  v_last_week_end := v_last_week_start + interval '6 days';

  for v_user in
    select user_id
      from public.trainings
     where date between v_last_week_start and v_last_week_end
       and user_id is not null
     group by user_id
     having count(*) >= 3
  loop
    -- Semaine précédente : ≥3 entraînements pour que le streak continue
    select count(*) into v_count
      from public.trainings
     where user_id = v_user.user_id
       and date between v_last_week_start - interval '7 days'
                    and v_last_week_start - interval '1 day';

    if v_count >= 3 then
      v_streak := 1;
      v_check_week := v_last_week_start;
      loop
        v_check_week := v_check_week - interval '7 days';
        select count(*) into v_count
          from public.trainings
         where user_id = v_user.user_id
           and date between v_check_week and v_check_week + interval '6 days';
        if v_count >= 3 then
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

-- Suppression du bonus de points "profile_photo" (+5 pts).
-- Le badge 📸 "Profil complet" reste géré côté client (BADGES).
-- → drop du trigger + fonction, des rows existantes, de l'index d'idempotence,
--   et mise à jour du CHECK constraint sur bonus_type.

drop trigger if exists trg_award_photo_bonus on public.profiles;
drop function if exists public.award_photo_bonus();

delete from public.point_bonuses where bonus_type = 'profile_photo';

drop index if exists public.point_bonuses_photo_unique;

alter table public.point_bonuses drop constraint if exists point_bonuses_bonus_type_check;
alter table public.point_bonuses
  add constraint point_bonuses_bonus_type_check
  check (bonus_type in ('signup', 'invitation', 'weekly_streak', 'pr_beaten'));

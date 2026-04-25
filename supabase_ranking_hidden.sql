-- ────────────────────────────────────────────────────────────────────────────
-- PaceRank — option "cacher du classement" sur les profils
-- À exécuter une seule fois dans Supabase → SQL Editor
-- ────────────────────────────────────────────────────────────────────────────

alter table public.profiles
  add column if not exists ranking_hidden boolean not null default false;

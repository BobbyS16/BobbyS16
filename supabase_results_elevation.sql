-- ────────────────────────────────────────────────────────────────────────────
-- PaceRank — colonne dénivelé pour les résultats trail
-- À exécuter une seule fois dans Supabase → SQL Editor
-- ────────────────────────────────────────────────────────────────────────────

alter table public.results
  add column if not exists elevation integer;

comment on column public.results.elevation is 'Dénivelé positif en mètres (utilisé uniquement pour les disciplines trail)';

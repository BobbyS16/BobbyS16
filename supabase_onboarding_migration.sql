-- ============================================================================
-- Migration : ajout d'un flag onboarding pour ne montrer le tour guidé
-- (5 écrans) qu'aux nouveaux inscrits — pas aux users existants.
--
-- À exécuter MANUELLEMENT dans le SQL editor Supabase APRÈS le déploiement
-- du code front qui lit/écrit cette colonne.
--
-- Ordre :
--   1. ALTER : crée la colonne avec DEFAULT false (les nouvelles lignes
--      auront automatiquement false → l'onboarding s'affichera).
--   2. UPDATE : marque tous les profils existants comme déjà onboardés
--      pour qu'ils ne voient pas le tour à leur prochaine connexion.
-- ============================================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false;

UPDATE profiles
  SET onboarding_completed = true
  WHERE onboarding_completed = false;

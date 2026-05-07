-- Étape 1 du système de notifications enrichi
-- Appliquée le 2026-05-07 sur le projet PaceRank (mmiezguttefoknaizmbs)
-- via Supabase MCP, migration: notifications_v1_payload_and_profile_flags

-- 1. Ajout d'une colonne payload jsonb sur notifications pour stocker les
--    variables dynamiques des libellés (discipline, points, rangs, etc.)
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS payload jsonb;

-- 2. Préférences utilisateur sur profiles
--    push_enabled              : reflet du opt-in OneSignal côté DB
--    in_app_enabled            : si false, cloche cachée + page Notifs vide
--    push_banner_dismissed_at  : "Plus tard 7 jours" (DB autoritaire)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS push_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS in_app_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS push_banner_dismissed_at timestamptz;

-- 3. Index pour la requête "historique chronologique" de la modale Notifs
CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON public.notifications (user_id, created_at DESC);

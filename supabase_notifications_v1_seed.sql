-- Seed de notifications de test pour valider l'affichage des 5 nouveaux types
-- Cible : c543c088-ef73-4c7d-9c71-75392b04d725
-- Acteur (from_user_id) pour les types friend_* : Physiotim
--   df55f2d8-7330-4a7a-b6a8-af7fe45bafbe
--
-- Toutes les lignes sont préfixées par un payload qui contient `seed_v1: true`,
-- ce qui permet de les supprimer en bloc d'un seul DELETE :
--   DELETE FROM public.notifications WHERE payload->>'seed_v1' = 'true';
--
-- Re-jouable : chaque INSERT est complet, on supprime puis on ré-insère.

BEGIN;

-- 1) Nettoyage idempotent des seeds précédents
DELETE FROM public.notifications WHERE payload->>'seed_v1' = 'true';

-- 2) Insertions
INSERT INTO public.notifications (user_id, from_user_id, type, read, payload, created_at) VALUES
  -- friend_official_race : Physiotim a participé à une course
  ('c543c088-ef73-4c7d-9c71-75392b04d725',
   'df55f2d8-7330-4a7a-b6a8-af7fe45bafbe',
   'friend_official_race', false,
   '{"seed_v1": true, "discipline": "10K", "race_name": "10K de Lyon"}'::jsonb,
   now() - interval '2 hours'),

  -- friend_pr : Physiotim a battu son record en Semi
  ('c543c088-ef73-4c7d-9c71-75392b04d725',
   'df55f2d8-7330-4a7a-b6a8-af7fe45bafbe',
   'friend_pr', false,
   '{"seed_v1": true, "discipline": "Semi"}'::jsonb,
   now() - interval '5 hours'),

  -- friend_overtake : Physiotim t'a dépassé au classement saison
  ('c543c088-ef73-4c7d-9c71-75392b04d725',
   'df55f2d8-7330-4a7a-b6a8-af7fe45bafbe',
   'friend_overtake', false,
   '{"seed_v1": true, "season": 2026, "by_pts": 12}'::jsonb,
   now() - interval '1 day'),

  -- league_overtake : tu as perdu 2 places dans la ligue Bronze
  ('c543c088-ef73-4c7d-9c71-75392b04d725',
   NULL,
   'league_overtake', false,
   '{"seed_v1": true, "old_rank": 3, "new_rank": 5, "league_name": "Bronze"}'::jsonb,
   now() - interval '2 days'),

  -- level_up_imminent : 99 pts avant le niveau Avancé
  ('c543c088-ef73-4c7d-9c71-75392b04d725',
   NULL,
   'level_up_imminent', false,
   '{"seed_v1": true, "current_points": 1601, "next_level_points": 1700, "next_level_name": "Avancé"}'::jsonb,
   now() - interval '3 days');

COMMIT;

-- Pour supprimer les seeds :
-- DELETE FROM public.notifications WHERE payload->>'seed_v1' = 'true';

-- Notifs : nettoyage du legacy activity_likes + backfill des 9 notifs orphelines.
-- Migration appliquée sur Supabase prod le 2026-05-13.
--
-- CONTEXTE
-- La table activity_likes (créée dans supabase_rpc_friendships.sql) a été
-- remplacée le 2026-05-11 par la table pyros (migration
-- supabase_pyros_and_comments_v1.sql), mais son trigger
-- trg_notify_activity_like est resté actif et créait encore des notifs typées
-- 'like_training' / 'like_result' (l'historique avait 9 rows orphelines de
-- ce style). Le code front n'insère plus dans activity_likes depuis cette
-- migration ; on droppe donc la table et on backfill les notifs au bon type
-- pour cohérence d'affichage et de push.

-- 1) Backfill : convertir les 9 notifs like_* en pyro_received
--    Payload reconstruit avec count=1, last_names=[short_name_actor],
--    activity_type, activity_id. Cohérent avec le format produit par le
--    trigger notify_pyro_received actuel.
update public.notifications n
set
  type = 'pyro_received',
  payload = jsonb_build_object(
    'count', 1,
    'last_names', jsonb_build_array(coalesce(public._actor_short_name(n.from_user_id), 'Un ami')),
    'activity_type', n.activity_type,
    'activity_id', n.activity_id
  )
where n.type in ('like_training', 'like_result')
  and n.from_user_id is not null;

-- 2) Drop la table legacy + son trigger (CASCADE supprime aussi le trigger).
--    La fonction notify_activity_like() devient orpheline, on la drop aussi.
drop table if exists public.activity_likes cascade;
drop function if exists public.notify_activity_like() cascade;

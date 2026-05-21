-- Avant : friendships_select_own = je vois UNIQUEMENT les friendships où
-- je suis user_id ou friend_id. Conséquence : impossible de voir la liste
-- d'amis d'un autre user depuis FriendProfileModal (la requête retourne
-- toujours 0 lignes pour les "amis d'amis").
--
-- Appliqué le 2026-05-22 via MCP
-- (migration allow_authenticated_read_friendships).
--
-- Fix : on ajoute une policy qui permet à tout user authentifié de LIRE
-- les friendships (uniquement les rows status='accepted' pour ne pas
-- exposer les demandes pending). Comme sur Strava ou Garmin Connect,
-- la liste d'amis est considérée comme info publique entre users connectés.

drop policy if exists friendships_select_own on public.friendships;

create policy friendships_select_accepted on public.friendships
  for select
  using (
    auth.role() = 'authenticated'
    and (
      -- Toujours visible si je suis impliqué (mes pending + mes acceptées)
      user_id = auth.uid()
      or friend_id = auth.uid()
      -- Sinon, seulement les acceptées (pas exposer les demandes pending
      -- entre tiers)
      or status = 'accepted'
    )
  );

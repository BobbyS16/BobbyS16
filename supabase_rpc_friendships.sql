-- Exécuter dans l'éditeur SQL Supabase (SQL Editor > New query)

-- Ajouter un ami de façon bidirectionnelle (contourne les RLS avec SECURITY DEFINER)
CREATE OR REPLACE FUNCTION add_friend(friend_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO friendships (user_id, friend_id, status)
  VALUES
    (auth.uid(), add_friend.friend_id, 'accepted'),
    (add_friend.friend_id, auth.uid(), 'accepted')
  ON CONFLICT (user_id, friend_id) DO UPDATE SET status = 'accepted';
END;
$$;

-- Supprimer un ami de façon bidirectionnelle
CREATE OR REPLACE FUNCTION remove_friend(friend_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM friendships
  WHERE
    (user_id = auth.uid() AND friendships.friend_id = remove_friend.friend_id)
    OR
    (user_id = remove_friend.friend_id AND friendships.friend_id = auth.uid());
END;
$$;

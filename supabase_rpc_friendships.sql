-- Exécuter dans l'éditeur SQL Supabase (SQL Editor > New query)

-- ── TABLE NOTIFICATIONS ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  type text NOT NULL DEFAULT 'friend_added',
  from_user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_select_own" ON notifications;
CREATE POLICY "notifications_select_own" ON notifications
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "notifications_update_own" ON notifications;
CREATE POLICY "notifications_update_own" ON notifications
  FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS "notifications_delete_own" ON notifications;
CREATE POLICY "notifications_delete_own" ON notifications
  FOR DELETE USING (user_id = auth.uid());

-- ── RPC : AJOUTER UN AMI (bidirectionnel + notification) ─────────────────────
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

  INSERT INTO notifications (user_id, type, from_user_id, read)
  VALUES (add_friend.friend_id, 'friend_added', auth.uid(), false);
END;
$$;

-- ── RPC : SUPPRIMER UN AMI (bidirectionnel) ──────────────────────────────────
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

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

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS activity_type text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS activity_id uuid;

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
DROP FUNCTION IF EXISTS add_friend(uuid);
CREATE FUNCTION add_friend(p_friend_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO friendships (user_id, friend_id, status)
  VALUES
    (auth.uid(), p_friend_id, 'accepted'),
    (p_friend_id, auth.uid(), 'accepted')
  ON CONFLICT (user_id, friend_id) DO UPDATE SET status = 'accepted';

  INSERT INTO notifications (user_id, type, from_user_id, read)
  VALUES (p_friend_id, 'friend_added', auth.uid(), false);
END;
$$;

-- ── RPC : SUPPRIMER UN AMI (bidirectionnel) ──────────────────────────────────
DROP FUNCTION IF EXISTS remove_friend(uuid);
CREATE FUNCTION remove_friend(p_friend_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM friendships
  WHERE
    (user_id = auth.uid() AND friend_id = p_friend_id)
    OR
    (user_id = p_friend_id AND friend_id = auth.uid());
END;
$$;

-- ── TABLE LIKES ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_likes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  activity_type text NOT NULL CHECK (activity_type IN ('result','training')),
  activity_id uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, activity_type, activity_id)
);

ALTER TABLE activity_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "activity_likes_select_all" ON activity_likes;
CREATE POLICY "activity_likes_select_all" ON activity_likes
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "activity_likes_insert_own" ON activity_likes;
CREATE POLICY "activity_likes_insert_own" ON activity_likes
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "activity_likes_delete_own" ON activity_likes;
CREATE POLICY "activity_likes_delete_own" ON activity_likes
  FOR DELETE USING (user_id = auth.uid());

-- ── TABLE COMMENTS ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_comments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  activity_type text NOT NULL CHECK (activity_type IN ('result','training')),
  activity_id uuid NOT NULL,
  content text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE activity_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "activity_comments_select_all" ON activity_comments;
CREATE POLICY "activity_comments_select_all" ON activity_comments
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "activity_comments_insert_own" ON activity_comments;
CREATE POLICY "activity_comments_insert_own" ON activity_comments
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "activity_comments_delete_own" ON activity_comments;
CREATE POLICY "activity_comments_delete_own" ON activity_comments
  FOR DELETE USING (user_id = auth.uid());

-- ── TRIGGER : NOTIFIER LE PROPRIÉTAIRE D'UN LIKE ─────────────────────────────
CREATE OR REPLACE FUNCTION notify_activity_like()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE owner_id uuid;
BEGIN
  IF NEW.activity_type = 'result' THEN
    SELECT user_id INTO owner_id FROM results WHERE id = NEW.activity_id;
  ELSIF NEW.activity_type = 'training' THEN
    SELECT user_id INTO owner_id FROM trainings WHERE id = NEW.activity_id;
  END IF;

  IF owner_id IS NOT NULL AND owner_id <> NEW.user_id THEN
    INSERT INTO notifications (user_id, type, from_user_id, activity_type, activity_id, read)
    VALUES (owner_id, 'like_' || NEW.activity_type, NEW.user_id, NEW.activity_type, NEW.activity_id, false);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_activity_like ON activity_likes;
CREATE TRIGGER trg_notify_activity_like
  AFTER INSERT ON activity_likes
  FOR EACH ROW EXECUTE FUNCTION notify_activity_like();

-- ── TRIGGER : NOTIFIER LE PROPRIÉTAIRE D'UN COMMENTAIRE ──────────────────────
CREATE OR REPLACE FUNCTION notify_activity_comment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE owner_id uuid;
BEGIN
  IF NEW.activity_type = 'result' THEN
    SELECT user_id INTO owner_id FROM results WHERE id = NEW.activity_id;
  ELSIF NEW.activity_type = 'training' THEN
    SELECT user_id INTO owner_id FROM trainings WHERE id = NEW.activity_id;
  END IF;

  IF owner_id IS NOT NULL AND owner_id <> NEW.user_id THEN
    INSERT INTO notifications (user_id, type, from_user_id, activity_type, activity_id, read)
    VALUES (owner_id, 'comment_' || NEW.activity_type, NEW.user_id, NEW.activity_type, NEW.activity_id, false);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_activity_comment ON activity_comments;
CREATE TRIGGER trg_notify_activity_comment
  AFTER INSERT ON activity_comments
  FOR EACH ROW EXECUTE FUNCTION notify_activity_comment();

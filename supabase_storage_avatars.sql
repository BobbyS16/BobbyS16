-- Créer le bucket avatars (public, 2 Mo max par fichier)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', true, 2097152, ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif'])
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 2097152,
  allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif'];

-- Lecture publique de tous les avatars
DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
CREATE POLICY "avatars_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

-- Les utilisateurs connectés peuvent uploader un avatar
DROP POLICY IF EXISTS "avatars_auth_insert" ON storage.objects;
CREATE POLICY "avatars_auth_insert" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'avatars' AND auth.role() = 'authenticated');

-- Les utilisateurs connectés peuvent remplacer leur avatar (upsert)
DROP POLICY IF EXISTS "avatars_auth_update" ON storage.objects;
CREATE POLICY "avatars_auth_update" ON storage.objects
  FOR UPDATE USING (bucket_id = 'avatars' AND auth.role() = 'authenticated');

-- Les utilisateurs connectés peuvent supprimer leur avatar
DROP POLICY IF EXISTS "avatars_auth_delete" ON storage.objects;
CREATE POLICY "avatars_auth_delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'avatars' AND auth.role() = 'authenticated');

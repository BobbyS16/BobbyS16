-- Fix du bucket storage `avatars` — appliqué le 2026-05-18 via MCP.
--
-- Bug : un ami a essayé d'uploader une photo de profil depuis son iPhone,
-- impossible de sauvegarder. Storage retourne 400 Bad Request (pas 403, donc
-- pas RLS). Deux causes cumulées :
--
-- 1. file_size_limit = 2 Mo : trop petit. Une photo iPhone HEIC en 12 MP
--    fait typiquement 3-5 Mo, une JPEG haute qualité aussi. Upload rejeté
--    systématiquement.
--
-- 2. allowed_mime_types contenait la chaîne littérale "\n  image/heic"
--    (avec un saut de ligne en début) au lieu de "image/heic" propre. Le
--    matching MIME ne pouvait jamais réussir pour HEIC → toute photo HEIC
--    (format par défaut des iPhone modernes) était rejetée comme MIME non
--    autorisé.
--
-- Fix : limite portée à 8 Mo, et la liste de MIME types nettoyée.

update storage.buckets
set
  file_size_limit = 8388608,  -- 8 Mo
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
where name = 'avatars';

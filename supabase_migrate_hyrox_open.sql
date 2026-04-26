-- Migration : renomme la discipline "hyrox-solo" en "hyrox-open"
-- À exécuter une seule fois dans le SQL editor de Supabase.
update results set discipline = 'hyrox-open' where discipline = 'hyrox-solo';

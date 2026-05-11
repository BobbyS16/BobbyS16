-- Cron horaire de nettoyage du statut EN FEU.
-- Appliquée le 2026-05-12 sur PaceRank (mmiezguttefoknaizmbs)
-- via Supabase MCP, migration: on_fire_v3_cron_cleanup
--
-- - Supprime les statuts expirés (expires_at < now())
-- - Supprime les extensions orphelines (user sans statut actif)

create or replace function public.cleanup_on_fire_expired()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.user_on_fire_status where expires_at < now();
  delete from public.on_fire_extensions
   where user_id not in (select user_id from public.user_on_fire_status);
$$;

do $$
begin
  perform cron.unschedule('on_fire_cleanup');
exception when others then null;
end $$;

select cron.schedule(
  'on_fire_cleanup',
  '0 * * * *',
  $$select public.cleanup_on_fire_expired()$$
);

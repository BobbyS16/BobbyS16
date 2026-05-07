-- Étape 2 du système de notifications : pipeline de push (étape a — infra)
-- Appliquée le 2026-05-07 sur le projet PaceRank (mmiezguttefoknaizmbs)
-- via Supabase MCP, migration: notifs_v2_push_pipeline_infra
--
-- Ne crée AUCUN type de notif. Ne fait que router toute INSERT sur
-- `notifications` vers l'endpoint Vercel /api/notifs/push-pending qui
-- s'occupe du push OneSignal.
--
-- Configuration runtime stockée dans Supabase Vault (hors migration) :
--   - notifs_dispatch_url    : URL de l'endpoint Vercel
--   - notifs_dispatch_secret : header x-pacerank-secret partagé

-- 1. Extensions
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. Colonne `pushed_at` : NULL = en attente d'envoi push
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS pushed_at timestamptz;

CREATE INDEX IF NOT EXISTS notifications_pushed_at_pending_idx
  ON public.notifications (created_at)
  WHERE pushed_at IS NULL;

-- 3. Helper : appelle l'endpoint Vercel via pg_net
CREATE OR REPLACE FUNCTION public._notifs_dispatch_call(p_source text DEFAULT 'manual')
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url text;
  v_secret text;
  v_request_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets WHERE name = 'notifs_dispatch_url' LIMIT 1;
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets WHERE name = 'notifs_dispatch_secret' LIMIT 1;
  IF v_url IS NULL OR v_secret IS NULL THEN
    RAISE WARNING '[notifs] vault secrets manquants — push skip';
    RETURN NULL;
  END IF;
  SELECT net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-pacerank-secret', v_secret
    ),
    body    := jsonb_build_object('source', p_source)
  ) INTO v_request_id;
  RETURN v_request_id;
END;
$$;

-- 4. Trigger AFTER INSERT : ping fire-and-forget. L'endpoint scanne
--    toutes les pending d'un coup, donc c'est idempotent.
CREATE OR REPLACE FUNCTION public._notifs_dispatch_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._notifs_dispatch_call('insert');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notifications_push_dispatch ON public.notifications;
CREATE TRIGGER trg_notifications_push_dispatch
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public._notifs_dispatch_after_insert();

-- 5. Filet de sécurité pg_cron : toutes les minutes, si du backlog
--    < 24h existe, on rappelle l'endpoint.
SELECT cron.unschedule('notifs_push_safety_net') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'notifs_push_safety_net'
);

SELECT cron.schedule(
  'notifs_push_safety_net',
  '* * * * *',
  $cron$
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM public.notifications
      WHERE pushed_at IS NULL
        AND created_at > now() - interval '24 hours'
    ) THEN public._notifs_dispatch_call('cron') END
  $cron$
);

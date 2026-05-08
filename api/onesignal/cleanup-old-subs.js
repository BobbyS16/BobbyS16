// /api/onesignal/cleanup-old-subs
//
// Nettoie les subs OneSignal obsolètes pour un user. À chaque réinstallation
// PWA / réactivation notifs, OneSignal crée une nouvelle Subscription côté
// device sans révoquer les anciennes — résultat : un même user finit avec
// N subs actives, et reçoit N pushs (welcome + chaque notif).
//
// Le SDK v16 ne dédup pas automatiquement les subs lors du login() : il lie
// juste la device courante à l'external_id, sans toucher aux autres subs
// liées au même user. D'où ce cleanup côté serveur.
//
// Auth : header Authorization: Bearer <supabase JWT>. L'external_user_id
// est extrait du JWT (jamais du body/query) → un user ne peut nettoyer que
// ses propres subs. NOTIFS_DISPATCH_SECRET ne convient pas ici car il
// serait exposé côté browser.
//
// Body JSON: { keep_subscription_id?: string, delete_all?: boolean }
//  - delete_all=true → supprime toutes les push subs liées à l'external_id.
//    Utilisé AVANT requestPermission pour repartir de zéro (la welcome
//    OneSignal route vers TOUTES les subs liées au user, donc supprimer
//    avant d'en créer une nouvelle évite la welcome dupliquée).
//  - keep_subscription_id → supprime toutes les push subs sauf celle-ci.
//    Utilisé en safety net post-optIn.

import { createClient } from "@supabase/supabase-js";

const ONESIGNAL_APP_ID = "35485edf-128a-4346-b6f6-a21a84645f47";
const ONESIGNAL_API_BASE = "https://api.onesignal.com";

// Types de sub OneSignal qui correspondent à un push web/mobile. On évite de
// toucher les subs Email/SMS qui peuvent légitimement coexister.
const PUSH_SUB_TYPES = new Set([
  "ChromePush", "FirefoxPush", "SafariPush", "SafariLegacyPush",
  "EdgePush", "iOSPush", "AndroidPush", "HuaweiPush", "WindowsPush",
]);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabaseUrl  = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const oneSignalKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!supabaseUrl || !serviceKey || !oneSignalKey) {
    return res.status(500).json({ error: "server misconfigured (env missing)" });
  }

  const authHeader = req.headers.authorization || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: "missing bearer token" });
  const jwt = match[1];

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: userData, error: authErr } = await supabase.auth.getUser(jwt);
  if (authErr || !userData?.user?.id) {
    return res.status(401).json({ error: "invalid token" });
  }
  const externalUserId = userData.user.id;

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const keepSubId = typeof body.keep_subscription_id === "string" ? body.keep_subscription_id : null;
  const deleteAll = body.delete_all === true;
  if (!keepSubId && !deleteAll) {
    return res.status(400).json({ error: "keep_subscription_id or delete_all=true required" });
  }

  const userUrl = `${ONESIGNAL_API_BASE}/apps/${ONESIGNAL_APP_ID}/users/by/external_id/${encodeURIComponent(externalUserId)}`;
  const userResp = await fetch(userUrl, {
    method: "GET",
    headers: { Authorization: `Key ${oneSignalKey}` },
  });
  if (userResp.status === 404) {
    return res.status(200).json({ deleted: 0, kept: 0, note: "user not found in OneSignal" });
  }
  if (!userResp.ok) {
    const txt = await userResp.text().catch(() => "");
    console.error("[cleanup-old-subs] view user failed", userResp.status, txt);
    return res.status(502).json({ error: "OneSignal view user failed", status: userResp.status });
  }
  const userJson = await userResp.json().catch(() => ({}));
  const subs = Array.isArray(userJson.subscriptions) ? userJson.subscriptions : [];

  const pushSubs = subs.filter(s => PUSH_SUB_TYPES.has(s.type));
  const toDelete = pushSubs.filter(s => s.id && (deleteAll || s.id !== keepSubId));

  let deleted = 0, failed = 0;
  for (const s of toDelete) {
    const delUrl = `${ONESIGNAL_API_BASE}/apps/${ONESIGNAL_APP_ID}/subscriptions/${s.id}`;
    try {
      const r = await fetch(delUrl, {
        method: "DELETE",
        headers: { Authorization: `Key ${oneSignalKey}` },
      });
      if (r.ok || r.status === 202 || r.status === 404) {
        deleted++;
      } else {
        failed++;
        const txt = await r.text().catch(() => "");
        console.warn("[cleanup-old-subs] delete failed", s.id, r.status, txt);
      }
    } catch (e) {
      failed++;
      console.error("[cleanup-old-subs] delete fetch error", s.id, e?.message || e);
    }
  }

  const kept = !deleteAll && pushSubs.some(s => s.id === keepSubId) ? 1 : 0;
  return res.status(200).json({
    external_user_id: externalUserId,
    total_push_subs: pushSubs.length,
    mode: deleteAll ? "delete_all" : "keep_one",
    kept,
    deleted,
    failed,
  });
}

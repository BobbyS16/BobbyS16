// /api/notifs/push-pending
//
// Worker du pipeline de push notifs (étape 2 — infra). Appelé par :
//  - Trigger pg_net AFTER INSERT ON notifications (fire-and-forget)
//  - pg_cron toutes les minutes (filet de sécurité pour les pushs ratés)
//
// Idempotent : scanne notifications.pushed_at IS NULL des dernières 24h,
// envoie un push OneSignal au destinataire (la livraison effective est gérée
// par OneSignal selon l'opt-out OS du device), puis stamp pushed_at = now()
// pour ne plus retraiter.
//
// Auth : header x-pacerank-secret == process.env.NOTIFS_DISPATCH_SECRET.

import { createClient } from "@supabase/supabase-js";

const ONESIGNAL_APP_ID = "35485edf-128a-4346-b6f6-a21a84645f47";
const ONESIGNAL_API = "https://onesignal.com/api/v1/notifications";

function buildPushContent(notif) {
  const fromName = notif.from_user?.name || "Quelqu'un";
  const p = notif.payload || {};
  switch (notif.type) {
    case "friend_added":         return { title: "👋 Nouvel ami",       body: `${fromName} t'a ajouté en ami` };
    case "friend_request":       return { title: "✉️ Demande d'ami",    body: `${fromName} veut t'ajouter en ami` };
    case "like_result":          return { title: "❤️ Like",             body: `${fromName} a aimé ta course` };
    case "like_training":        return { title: "❤️ Like",             body: `${fromName} a aimé ton entraînement` };
    case "comment_result":       return { title: "💬 Commentaire",      body: `${fromName} a commenté ta course` };
    case "comment_training":     return { title: "💬 Commentaire",      body: `${fromName} a commenté ton entraînement` };
    case "pyro_received": {
      const count = Number(p.count) || 1;
      const aLabel = p.activity_type === "training" ? "ton entraînement" : "ta course";
      if (count > 1) {
        return { title: `🔥 ${count} amis t'ont envoyé un pyro`, body: `Sur ${aLabel}` };
      }
      return { title: `🔥 ${fromName} t'a envoyé un pyro`, body: `Sur ${aLabel}` };
    }
    case "comment_received": {
      const aLabel = p.activity_type === "training" ? "ton entraînement" : "ta course";
      const intro = p.is_owner ? `${fromName} a commenté ${aLabel}` : `${fromName} a aussi commenté ${aLabel}`;
      return { title: "💬 Nouveau commentaire", body: p.preview ? `${intro} : « ${p.preview} »` : intro };
    }
    case "friend_overtake": {
      const after = p.actor_score ?? null;
      const mine  = p.friend_score ?? null;
      if (after !== null && mine !== null) {
        return { title: `📉 ${fromName} t'a dépassé !`, body: `Il est à ${after} pts contre tes ${mine} pts, reprends le dessus` };
      }
      return { title: "📉 Dépassé", body: `${fromName} t'a dépassé au classement saison` };
    }
    case "lost_podium": {
      const lg = p.league_label || (p.league ? p.league.charAt(0).toUpperCase()+p.league.slice(1) : "");
      return { title: "🥉 Tu as perdu ton podium !", body: `Plus que la ${p.new_rank || "?"}e place${lg ? ` en ${lg}` : ""}` };
    }
    case "friend_official_race": return { title: "🏁 Course officielle", body: `${fromName} a participé à ${p.race_name || "une course"}` };
    case "friend_pr":            return { title: "🏆 Record battu",     body: `${fromName} a battu son record en ${p.discipline || "course"}` };
    case "friend_upcoming_race": {
      const days = p.days_until ? Number(p.days_until) : null;
      const when = days === 1 ? "Demain" : (days > 1 ? `Dans ${days} jours` : "Bientôt");
      return { title: `📅 ${fromName} court ${p.race_name || "une course"}`, body: `${when} — fais ton prono !` };
    }
    case "friend_prono": {
      const race = p.race_name || "ta course";
      const time = p.predicted_time || "?";
      return { title: `🎯 Nouveau prono d'un ami`, body: `${fromName} a pronostiqué ${time} sur ${race}` };
    }
    case "league_overtake": {
      const lg = p.league_label || p.league_name || "";
      // Phase B : envoyé quand l'user sort du top 5 (rang 4-5 → 6+).
      if (p.actor_name) {
        return { title: `🏆 Tu sors du top 5${lg ? " "+lg : ""}`, body: `${p.actor_name} t'est passé devant` };
      }
      // Fallback legacy : payload "old_rank/new_rank" sans actor.
      const drop = (p.new_rank || 0) - (p.old_rank || 0);
      if (drop > 0) return { title: "📉 Rang ligue", body: `Tu as perdu ${drop} place${drop>1?"s":""} dans ta ligue${lg ? " ("+lg+")" : ""}` };
      if (drop < 0) return { title: "📈 Rang ligue", body: `Tu as gagné ${-drop} place${-drop>1?"s":""} dans ta ligue${lg ? " ("+lg+")" : ""}` };
      return { title: "📊 Rang ligue", body: "Changement de rang dans ta ligue" };
    }
    case "level_up_imminent": {
      const remaining = Math.max(0, (p.next_milestone || 0) - (p.current_points || 0));
      return { title: "⭐ Bientôt un palier", body: `Plus que ${remaining} pts avant le cap des ${p.next_milestone} pts` };
    }
    case "level_up":
      return { title: "🎉 Palier franchi", body: `Tu as franchi le cap des ${p.milestone} pts !` };
    case "weekly_recap":
      return { title: "📊 Récap de la semaine", body: "Ouvre PaceRank pour voir ton bilan" };
    case "comeback":
      return { title: "👋 On t'attend", body: "Reprends une session, ton classement bouge sans toi" };
    default:
      return { title: "PaceRank", body: "Nouvelle notification" };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const expected = process.env.NOTIFS_DISPATCH_SECRET;
  const provided = req.headers["x-pacerank-secret"];
  if (!expected || provided !== expected) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const supabaseUrl  = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const oneSignalKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!supabaseUrl || !serviceKey || !oneSignalKey) {
    return res.status(500).json({ error: "server misconfigured (env missing)" });
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: notifs, error: qErr } = await supabase
    .from("notifications")
    .select("id, user_id, type, payload, from_user:profiles!notifications_from_user_id_fkey(id,name)")
    .is("pushed_at", null)
    .gt("created_at", since)
    .order("created_at", { ascending: true })
    .limit(50);

  if (qErr) {
    console.error("[push-pending] query failed", qErr);
    return res.status(500).json({ error: qErr.message });
  }
  if (!notifs || notifs.length === 0) {
    return res.status(200).json({ processed: 0 });
  }

  const recipientIds = [...new Set(notifs.map(n => n.user_id))];
  // On ne lit plus profiles.push_enabled : le toggle in-app a été retiré, la
  // livraison est désormais gérée par OneSignal + opt-out OS du device. On
  // garde quand même la lookup par id pour valider l'existence du profil.
  const { data: recipients } = await supabase
    .from("profiles")
    .select("id, name")
    .in("id", recipientIds);
  const byId = Object.fromEntries((recipients || []).map(r => [r.id, r]));

  // Rate-limit : on charge le dernier push réel par user (push_skipped_reason
  // IS NULL = vraie sortie OneSignal). Les rows skipped pour rate_limit ou
  // push_disabled ne comptent pas dans la fenêtre, sinon on bloquerait
  // indéfiniment l'utilisateur après le premier skip.
  // Bypass possible via NOTIFS_BYPASS_RATE_LIMIT=true (utile pour tester
  // le pipeline sans attendre 1h entre chaque push).
  const RATE_LIMIT_MS = 60 * 60 * 1000;
  const bypassRateLimit = process.env.NOTIFS_BYPASS_RATE_LIMIT === "true";
  if (bypassRateLimit) console.warn("[push-pending] ⚠️ rate-limit BYPASS via NOTIFS_BYPASS_RATE_LIMIT=true");
  const lastPushByUser = {};
  if (!bypassRateLimit) {
    const cutoff = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
    const { data: recentPushes } = await supabase
      .from("notifications")
      .select("user_id, pushed_at")
      .in("user_id", recipientIds)
      .is("push_skipped_reason", null)
      .gt("pushed_at", cutoff)
      .order("pushed_at", { ascending: false });
    for (const row of (recentPushes || [])) {
      if (!lastPushByUser[row.user_id]) lastPushByUser[row.user_id] = new Date(row.pushed_at).getTime();
    }
  }

  // Stamps groupés : on regroupe les ids par push_skipped_reason pour 1 update / cas.
  const stampNormal = [];     // push réel parti → pushed_at = now, reason = NULL
  const stampDisabled = [];   // recipient introuvable (profil supprimé)
  const stampRateLimit = [];  // skip parce que <1h depuis dernier push
  const stampSoftError = [];  // OneSignal a renvoyé une erreur soft (ex: external_id introuvable)
  let pushed = 0, skipped = 0, failed = 0;

  for (const n of notifs) {
    const recipient = byId[n.user_id];
    if (!recipient) {
      // Profil introuvable (ex: user supprimé) → on stamp pour ne plus
      // retraiter mais on n'envoie pas.
      stampDisabled.push(n.id);
      skipped++;
      continue;
    }

    // Rate-limit : si l'user a reçu un push dans la dernière heure, on skippe.
    const lastTs = lastPushByUser[recipient.id] || 0;
    if (lastTs && (Date.now() - lastTs) < RATE_LIMIT_MS) {
      console.log("[push-pending] rate-limited", n.id, "user", recipient.id, "last push", new Date(lastTs).toISOString());
      stampRateLimit.push(n.id);
      skipped++;
      continue;
    }

    let { title, body } = buildPushContent(n);
    // Filet de sécurité iOS Web Push : Apple drop silencieusement les
    // pushs si headings ou contents sont vides/null. On force un fallback
    // générique non-vide même si le builder a renvoyé une chaîne vide.
    if (!title || !String(title).trim()) title = "PaceRank";
    if (!body  || !String(body).trim())  body  = "Nouvelle notification";

    // Format aligné sur l'exemple "minimal qui marche" pour iOS Web Push :
    //   include_external_user_ids (legacy Player Model, bien supporté pour iOS)
    //   headings.en + contents.en (Apple ignore parfois les autres locales)
    //
    // ⚠️ Pas de web_url : la PWA est installée depuis pacerank.vercel.app
    // mais notre custom domain est www.pacerank.app. iOS Web Push drop
    // silencieusement les pushs dont web_url ne matche pas le scope de la
    // sub. En l'absence du champ, OneSignal utilise le Site URL configuré
    // dans Web Configuration (= bon scope) → livraison fiable.
    //
    // On garde data {notification_id, type} pour les deeplinks PWA.
    const oneSignalBody = {
      app_id: ONESIGNAL_APP_ID,
      include_external_user_ids: [recipient.id],
      headings: { en: title },
      contents: { en: body },
      data: { notification_id: n.id, type: n.type },
    };
    console.log("[push-pending] →OneSignal", n.id, JSON.stringify(oneSignalBody));

    try {
      const r = await fetch(ONESIGNAL_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${oneSignalKey}`,
        },
        body: JSON.stringify(oneSignalBody),
      });
      const json = await r.json().catch(() => ({}));
      console.log("[push-pending] ←OneSignal", n.id, "status", r.status, "json", JSON.stringify(json));
      const errMsg = Array.isArray(json.errors) ? json.errors.join(" | ") : (json.errors?.invalid_external_user_ids ? "external_id not found" : "");
      if (!r.ok) {
        console.error("[push-pending] OneSignal http error", n.id, r.status, json);
        failed++;
        if (r.status >= 400 && r.status < 500) stampSoftError.push(n.id);
      } else if (errMsg) {
        console.warn("[push-pending] OneSignal soft error", n.id, errMsg);
        stampSoftError.push(n.id);
        skipped++;
      } else {
        // Sanity check : si recipients = 0 dans la réponse, le push n'a pas
        // été délivré (audience filter n'a matché personne).
        if (json.recipients !== undefined && json.recipients === 0) {
          console.warn("[push-pending] OneSignal accepted but recipients=0", n.id, "external_id", recipient.id);
        }
        stampNormal.push(n.id);
        // On met à jour le map pour rate-limiter les notifs suivantes du
        // même user dans le même batch (sauf si bypass actif).
        if (!bypassRateLimit) lastPushByUser[recipient.id] = Date.now();
        pushed++;
      }
    } catch (e) {
      console.error("[push-pending] fetch failed", n.id, e?.message || e);
      failed++;
      // Erreur réseau → on ne stamp pas, le cron retentera dans 1 min
    }
  }

  const nowIso = new Date().toISOString();
  const updates = [
    { ids: stampNormal,     reason: null,             label: "normal" },
    { ids: stampDisabled,   reason: "push_disabled",  label: "disabled" },
    { ids: stampRateLimit,  reason: "rate_limit",     label: "rate_limit" },
    { ids: stampSoftError,  reason: "soft_error",     label: "soft_error" },
  ];
  for (const u of updates) {
    if (u.ids.length === 0) continue;
    const { error: uErr } = await supabase
      .from("notifications")
      .update({ pushed_at: nowIso, push_skipped_reason: u.reason })
      .in("id", u.ids);
    if (uErr) console.error(`[push-pending] stamp ${u.label} failed`, uErr);
  }

  return res.status(200).json({
    processed: notifs.length,
    pushed,
    skipped,
    failed,
    rate_limited: stampRateLimit.length,
  });
}

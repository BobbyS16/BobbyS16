// /api/strava/webhook
//
// Webhook receiver pour les Push Subscriptions Strava. Notifié par Strava
// dès qu'un user crée / met à jour / supprime une activité.
//
// 2 modes :
//   - GET  : challenge de vérification de subscription (validation initiale
//            par Strava lors du POST /push_subscriptions)
//   - POST : event d'activité, on fetch les détails et on insère en DB
//
// Flow POST :
//   1. Strava → POST { aspect_type, object_type, object_id, owner_id, ... }
//   2. Lookup user_id Pacerank via strava_tokens.athlete_id = owner_id
//   3. Refresh access_token si expiré
//   4. GET https://www.strava.com/api/v3/activities/{object_id}
//   5. Map type Strava → sport Pacerank
//   6. Calc points (formule allure-based, ou suffer_score → training_load)
//   7. Insert/update trainings (dédup par strava_activity_id)
//   8. 200 OK rapide (Strava attend < 2s sinon désactive la sub)

import { createClient } from "@supabase/supabase-js";
import { calculateTrainingPoints } from "../../src/utils/trainingPoints.js";

const STRAVA_TO_SPORT = {
  Run: "Run",
  TrailRun: "Trail",
  Hike: "Trail",
  Ride: "Vélo",
  VirtualRide: "Vélo",
  MountainBikeRide: "Vélo",
  GravelRide: "Vélo",
  EBikeRide: "Vélo",
  Swim: "Natation",
};

const SPORT_TO_DISCIPLINE = {
  Run: "running",
  Trail: "trail",
  "Vélo": "cycling",
  Natation: "swimming",
};

function computePaceOrSpeed(discipline, distanceKm, durationSec) {
  if (!distanceKm || !durationSec) return 0;
  if (discipline === "running" || discipline === "trail") return durationSec / distanceKm;
  if (discipline === "cycling") return distanceKm / (durationSec / 3600);
  if (discipline === "swimming") return durationSec / (distanceKm * 10);
  return 0;
}

// Refresh le token si nécessaire. Retourne le token valide à utiliser.
async function ensureFreshToken(supabase, row) {
  const expiresAt = new Date(row.expires_at).getTime();
  // marge 60s pour éviter les race conditions
  if (Date.now() < expiresAt - 60_000) return row.access_token;

  const r = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: row.refresh_token,
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Refresh failed: ${data.message || r.status}`);

  // Update DB
  await supabase.from("strava_tokens")
    .update({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: new Date(data.expires_at * 1000).toISOString(),
    })
    .eq("user_id", row.user_id);

  return data.access_token;
}

export default async function handler(req, res) {
  // ─── Mode GET : challenge de subscription ─────────────────────────────────
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    const expected = process.env.STRAVA_VERIFY_TOKEN;
    if (mode === "subscribe" && token === expected && challenge) {
      console.log("[strava-webhook] subscription verified");
      return res.status(200).json({ "hub.challenge": challenge });
    }
    return res.status(403).json({ error: "Verify token mismatch" });
  }

  // ─── Mode POST : event d'activité ────────────────────────────────────────
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // On répond IMMÉDIATEMENT à Strava pour respecter la fenêtre 2s.
  // Le traitement réel est asynchrone (fire-and-forget).
  res.status(200).json({ ok: true });

  const event = req.body || {};
  console.log("[strava-webhook] received event", JSON.stringify(event));

  // On ne traite que les nouvelles activités (pas les updates ni deletes
  // pour l'instant — pourra être étendu plus tard).
  if (event.object_type !== "activity" || event.aspect_type !== "create") {
    console.log("[strava-webhook] event ignored (not activity create)");
    return;
  }

  const athleteId = event.owner_id;
  const activityId = event.object_id;
  if (!athleteId || !activityId) {
    console.warn("[strava-webhook] missing owner_id or object_id");
    return;
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      console.error("[strava-webhook] missing Supabase env");
      return;
    }
    const supabase = createClient(supabaseUrl, serviceKey);

    // Lookup user Pacerank
    const { data: row, error: tokErr } = await supabase
      .from("strava_tokens")
      .select("*")
      .eq("athlete_id", athleteId)
      .maybeSingle();
    if (tokErr || !row) {
      console.warn(`[strava-webhook] no user for athlete_id=${athleteId}`, tokErr);
      return;
    }

    // Refresh token si nécessaire
    let accessToken;
    try { accessToken = await ensureFreshToken(supabase, row); }
    catch (e) { console.error("[strava-webhook] refresh failed", e); return; }

    // Fetch les détails de l'activité
    const actR = await fetch(
      `https://www.strava.com/api/v3/activities/${activityId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const a = await actR.json();
    if (!actR.ok) {
      console.error(`[strava-webhook] activity fetch failed`, a);
      return;
    }

    // Map type → sport Pacerank
    const stravaType = a.sport_type || a.type;
    const sport = STRAVA_TO_SPORT[stravaType];
    if (!sport) {
      console.log(`[strava-webhook] sport type ignored: ${stravaType}`);
      return;
    }

    // Dédup : si déjà importé via la même activity_id Strava, skip
    const stravaIdStr = String(activityId);
    const { data: existing } = await supabase
      .from("trainings")
      .select("id")
      .eq("user_id", row.user_id)
      .eq("strava_activity_id", stravaIdStr)
      .maybeSingle();
    if (existing) {
      console.log(`[strava-webhook] activity ${activityId} already imported, skip`);
      return;
    }

    // Construit le payload
    const distance = +(a.distance / 1000).toFixed(2); // m → km
    const duration = a.moving_time || 0; // secondes
    const date = (a.start_date_local || a.start_date || "").slice(0, 10);
    const elevation = a.total_elevation_gain || 0;
    const discipline = SPORT_TO_DISCIPLINE[sport];

    // Suffer score Strava (similar to Garmin TL) — si présent, on l'utilise
    // comme training_load. Sinon → fallback formule allure-based.
    const trainingLoad = (a.suffer_score != null && a.suffer_score > 0)
      ? Math.round(a.suffer_score) : null;

    let points = 0;
    try {
      points = calculateTrainingPoints({
        discipline,
        duration_min: duration / 60,
        distance_km: distance,
        elevation_gain_m: elevation,
        pace_or_speed: computePaceOrSpeed(discipline, distance, duration),
        training_load: trainingLoad,
      });
    } catch (e) {
      console.warn(`[strava-webhook] pts calc failed`, e.message);
    }

    const insertPayload = {
      user_id: row.user_id,
      sport,
      title: a.name || null,
      distance,
      duration,
      elevation_gain_m: elevation || null,
      date,
      points,
      training_load: trainingLoad,
      source: "strava",
      strava_activity_id: stravaIdStr,
    };

    const { error: insErr } = await supabase
      .from("trainings")
      .insert(insertPayload);
    if (insErr) {
      console.error(`[strava-webhook] insert failed`, insErr);
      return;
    }

    console.log(`[strava-webhook] imported activity ${activityId} (${sport}, ${distance}km, ${points} pts) for user ${row.user_id}`);
  } catch (e) {
    console.error("[strava-webhook] handler error", e);
  }
}

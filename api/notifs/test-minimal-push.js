// /api/notifs/test-minimal-push
//
// Test isolatif iOS : envoie à OneSignal un payload ULTRA-MINIMAL
// (app_id + include_external_user_ids + headings.en + contents.en).
// Pas de data, pas de web_url, pas d'emoji. Strict minimum.
//
// Si la notif arrive sur le lock screen iOS → l'un des champs absents
// (data / web_url / emoji dans les titres) du payload normal pose
// problème. On les réintroduira un par un pour identifier le coupable.
// Si elle n'arrive pas non plus → le souci est plus profond (sub iOS
// ou config OneSignal côté Dashboard).
//
// Auth : header x-pacerank-secret == process.env.NOTIFS_DISPATCH_SECRET.
// Méthode : POST. Body JSON optionnel : { external_user_id?: string }
// Si non fourni, default = c543c088-... (Philippe).

const ONESIGNAL_APP_ID = "35485edf-128a-4346-b6f6-a21a84645f47";
const ONESIGNAL_API = "https://onesignal.com/api/v1/notifications";
const DEFAULT_TARGET = "c543c088-ef73-4c7d-9c71-75392b04d725";

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

  const oneSignalKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!oneSignalKey) {
    return res.status(500).json({ error: "server misconfigured (ONESIGNAL_REST_API_KEY missing)" });
  }

  // Lit external_user_id optionnel depuis le body, sinon default.
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const externalUserId = body?.external_user_id || DEFAULT_TARGET;

  const minimalPayload = {
    app_id: ONESIGNAL_APP_ID,
    include_external_user_ids: [externalUserId],
    headings: { en: "Test minimal" },
    contents: { en: "Body minimal" },
  };
  console.log("[test-minimal-push] →OneSignal", JSON.stringify(minimalPayload));

  try {
    const r = await fetch(ONESIGNAL_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${oneSignalKey}`,
      },
      body: JSON.stringify(minimalPayload),
    });
    const json = await r.json().catch(() => ({}));
    console.log("[test-minimal-push] ←OneSignal status", r.status, "json", JSON.stringify(json));
    return res.status(200).json({
      sent_payload: minimalPayload,
      onesignal_status: r.status,
      onesignal_response: json,
    });
  } catch (e) {
    console.error("[test-minimal-push] fetch failed", e?.message || e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

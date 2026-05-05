import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing bearer token" });
  }
  const token = authHeader.slice(7);

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseAnon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnon) {
    return res.status(500).json({ error: "Supabase not configured (set SUPABASE_URL and SUPABASE_ANON_KEY)" });
  }

  const supabase = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return res.status(401).json({ error: "Invalid token", details: authErr?.message });
  }

  const { endpoint, p256dh, auth } = req.body || {};
  if (!endpoint || !p256dh || !auth) {
    return res.status(400).json({ error: "Missing endpoint, p256dh, or auth" });
  }

  let type = "ChromePush";
  if (endpoint.includes("web.push.apple.com")) type = "SafariPush";
  else if (endpoint.includes("mozilla")) type = "FirefoxPush";

  const appId = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!appId || !apiKey) {
    return res.status(500).json({ error: "OneSignal not configured (set ONESIGNAL_APP_ID and ONESIGNAL_REST_API_KEY)" });
  }

  const authPrefix = apiKey.startsWith("os_v2_") ? "Key" : "Basic";

  try {
    const r = await fetch(
      `https://api.onesignal.com/apps/${appId}/users/by/external_id/${user.id}/subscriptions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `${authPrefix} ${apiKey}`,
        },
        body: JSON.stringify({
          subscription: {
            type,
            token: endpoint,
            web_auth: auth,
            web_p256: p256dh,
            enabled: true,
            notification_types: 1,
          },
        }),
      }
    );

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(r.status).json({ error: "OneSignal API error", details: data });
    }

    const playerId = data?.subscription?.id || data?.id;
    if (playerId) {
      const admin = createClient(supabaseUrl, supabaseAnon, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      await admin.from("push_subscriptions").upsert(
        {
          user_id: user.id,
          onesignal_player_id: playerId,
          last_seen: new Date().toISOString(),
          active: true,
        },
        { onConflict: "user_id,onesignal_player_id" }
      );
    }

    return res.status(200).json({ player_id: playerId, type, raw: data });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Registration failed" });
  }
}

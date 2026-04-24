#!/usr/bin/env node
// Usage:
//   node tools/strava-deauth.mjs <access_token>
//   STRAVA_ACCESS_TOKEN=xxx node tools/strava-deauth.mjs
//
// If only a refresh_token is available, first exchange it for a fresh
// access_token by setting STRAVA_REFRESH_TOKEN, STRAVA_CLIENT_ID and
// STRAVA_CLIENT_SECRET, then run the script with no args.

const arg = process.argv[2];
let accessToken = arg || process.env.STRAVA_ACCESS_TOKEN;

async function refreshIfNeeded() {
  if (accessToken) return;
  const refresh = process.env.STRAVA_REFRESH_TOKEN;
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!refresh || !clientId || !clientSecret) return;
  console.log("[deauth] no access_token — refreshing from refresh_token");
  const r = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refresh,
    }),
  });
  const data = await r.json();
  console.log("[deauth] refresh status:", r.status);
  if (!r.ok) {
    console.error("[deauth] refresh body:", JSON.stringify(data, null, 2));
    process.exit(2);
  }
  accessToken = data.access_token;
  console.log("[deauth] obtained fresh access_token (expires_at=" + data.expires_at + ")");
}

await refreshIfNeeded();

if (!accessToken) {
  console.error(
    "Missing access_token.\n" +
    "Provide one of:\n" +
    "  - argument: node tools/strava-deauth.mjs <access_token>\n" +
    "  - env STRAVA_ACCESS_TOKEN\n" +
    "  - env STRAVA_REFRESH_TOKEN + STRAVA_CLIENT_ID + STRAVA_CLIENT_SECRET (auto-refresh)"
  );
  process.exit(1);
}

console.log("[deauth] POST https://www.strava.com/oauth/deauthorize");
const res = await fetch("https://www.strava.com/oauth/deauthorize", {
  method: "POST",
  headers: { Authorization: `Bearer ${accessToken}` },
});

const text = await res.text();
let body;
try { body = JSON.parse(text); } catch { body = text; }

console.log("[deauth] HTTP status:", res.status);
console.log("[deauth] response body:", typeof body === "string" ? body : JSON.stringify(body, null, 2));

if (!res.ok) process.exit(3);

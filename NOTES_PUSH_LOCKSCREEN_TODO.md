# Push notifications — TODO lock screen iOS

## ✅ RÉSOLU le 2026-05-15 (commit `5fd89bd`)

**Vraie cause :** conflit de Service Workers au scope `/`.

- `/OneSignalSDKWorker.js` enregistré par `OneSignal.init()`
- `/sw.js` enregistré par `vite-plugin-pwa` (`injectRegister: 'auto'`)

vite-pwa s'enregistrait après OneSignal et écrasait le SW OneSignal. Résultat :
OneSignal acceptait la requête (HTTP 200, `pushed:1`), APNS livrait au device,
mais aucun SW OneSignal n'était là pour réceptionner → drop silencieux.
Symptôme dans Safari Web Inspector : `[WM] No SW registration for postMessage`.

**Fix :**
- `vite.config.js` : `injectRegister: false`
- `public/OneSignalSDKWorker.js` : `importScripts('/sw.js')` en plus du SDK
  OneSignal → un seul SW unifié qui gère push + workbox precache.

**Validation :** désinstaller la PWA iOS + réinstaller (nécessaire pour
remplacer le SW déjà enregistré), puis envoyer une notif test. Lock screen OK.

## Historique (pour archive)

### État au 2026-05-07 (soir)

- Pipeline serveur : INSERT `notifications` → trigger pgnet → POST Vercel → handler `api/notifs/push-pending` → OneSignal HTTP 200 ✅
- Notifications in-app : OK
- **Lock screen iOS** : réception intermittente — hypothèse OneSignal/iOS bug ❌ (mauvaise piste, c'était le conflit SW)

### Sécurité

- Token Vercel Protection Bypass à régénérer (transité dans le chat le 2026-05-07) — secret Vault `notifs_bypass_token` (id `b7f7c1cc-6140-4059-9dac-9a6ef71670a2`)

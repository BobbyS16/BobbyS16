# Push notifications — TODO lock screen iOS

## État au 2026-05-07 (soir)

### Validé
- Pipeline serveur : INSERT `notifications` → trigger pgnet → POST Vercel preview → handler `api/notifs/push-pending` → OneSignal HTTP 200
- Notifications in-app : OK
- Branche : `notifs-triggers-v2` (preview Vercel only, pas encore mergée sur `main`)

### Problème ouvert
- **Lock screen iOS** : réception intermittente sur écran verrouillé
- Cause probable : bug connu OneSignal (Web Push + iOS Safari/PWA, payload livré au service worker mais pas systématiquement remonté en bannière lock screen)
- Pas un bug applicatif côté Pacerank — le pipeline délivre, OneSignal accepte (HTTP 200)

## À faire demain matin

1. Merge `notifs-triggers-v2` → `main`
2. Update le secret Vault `notifs_dispatch_url` pour repointer vers l'endpoint production (`https://www.pacerank.app/api/notifs/push-pending?x-vercel-set-bypass-cookie=true` — ou retirer le query param + retirer le header bypass si plus nécessaire en prod)
3. Désinstaller la PWA iOS, vider le cache Safari, réinstaller fresh
4. Renvoyer une notification test et vérifier la livraison sur lock screen
5. Si toujours intermittent : tracker le `notification.id` côté OneSignal dashboard pour confirmer "delivered" vs "displayed"

## Sécurité
- Token Vercel Protection Bypass à régénérer (transité dans le chat aujourd'hui) — voir secret Vault `notifs_bypass_token` (id `b7f7c1cc-6140-4059-9dac-9a6ef71670a2`)

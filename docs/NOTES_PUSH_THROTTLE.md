# Push iOS Web Push — hypothèse "throttle" écartée

## ❌ HYPOTHÈSE INVALIDÉE le 2026-05-15

Cette note documentait une hypothèse de **throttle device-specific Apple** suite
à plusieurs cycles install/uninstall et toggles de souscription. **Cette
hypothèse était fausse.**

Le vrai problème était un conflit de Service Workers entre `vite-plugin-pwa`
et `OneSignalSDKWorker.js` au scope `/`. Voir [`NOTES_PUSH_LOCKSCREEN_TODO.md`](../NOTES_PUSH_LOCKSCREEN_TODO.md)
et commit `5fd89bd` pour le fix.

Le throttle Apple Web Push existe peut-être, mais ce n'était pas le sujet ici.
Symptôme attendu si on retombe sur ça : `[WM] No SW registration for postMessage`
dans la console Safari Web Inspector + lock screen muet alors que OneSignal
dashboard affiche "Delivered".

## Historique (archivé)

### État au 2026-05-13 18:10

Pipeline serveur OK (HTTP 200, `pushed:1`), sub OneSignal apparemment propre,
iOS notifs activées, Site URL OneSignal cohérent. Notif n'arrivait pas sur
lock screen même après reboot. On avait alors suspecté un throttle Apple suite
aux nombreuses manipulations de la journée (réinstalls, toggles, suppressions
de sub). Le plan de "laisser reposer 24h" n'a rien changé — 48h après, le
problème persistait, confirmant que le throttle n'était pas la cause.

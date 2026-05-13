# Push iOS Web Push — throttle suspecté

## État au 2026-05-13 18:10

### Ce qui fonctionne
- **Pipeline push validé côté serveur** : HTTP 200, `pushed:1`, `failed:0`
- **Sub OneSignal unique et propre** : statut `Subscribed`, 1 User, `external_id` bien lié au profil PaceRank
- **iOS notifications activées au niveau OS** : permissions accordées, pas de mode silence
- **Site URL OneSignal cohérent** avec l'origine de la PWA (`pacerank.vercel.app`)

### Ce qui ne fonctionne pas
- **La notif n'arrive PAS sur le lock screen iPhone**, même après reboot du device

## Hypothèse principale

**Throttle iOS Web Push** dû à un trop grand nombre de manipulations dans la journée :

- 3 réinstalls PWA
- 5+ delete sub
- 4+ toggle notif
- Plusieurs OneSignal Users créés/supprimés

Apple drop silencieusement les pushs pour cette combinaison app/device lorsqu'il détecte un pattern de subscription/unsubscription abusif. Aucune erreur retournée côté APNS — la notif est juste avalée. C'est une protection anti-spam non documentée publiquement mais largement observée par les ops Web Push.

## Plan d'action

1. **Laisser reposer 24h** sans aucune manipulation côté device (pas de réinstall, pas de toggle, pas de re-subscribe).
2. **Retester demain matin** avec UN seul INSERT SQL d'une notif :
   ```sql
   insert into notifications (user_id, type, payload, read)
   values ('c543c088-ef73-4c7d-9c71-75392b04d725', 'friend_prono',
     jsonb_build_object('race_name','Test','predicted_time','01:00:00','predictor_name','Test'),
     false);
   ```
3. **Évaluation** :
   - Notif reçue sur lock screen → throttle confirmé, résolu naturellement
   - Notif toujours absente → cas plus profond à investiguer (subscription corrompue, certificat APNS, autre)

## Important — pas un bug général

Ce throttle est **device-specific**. Les autres utilisateurs ne rencontreront PAS ce problème puisqu'ils n'auront pas effectué les cycles d'install/uninstall et de toggles. C'est uniquement l'effet de bord de notre session de debug intensive de la journée.

→ Aucun fix code à pousser. Aucune migration à appliquer. Attendre.

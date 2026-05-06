# Debug Push iOS - État au 6 mai 00h45

## Ce qui marche
- Env vars Vercel complètes (ONESIGNAL_*, SUPABASE_* avec et sans 
  préfixe VITE_)
- Tous les deploys Ready
- Modal "Active les notifs" s'affiche correctement
- Flow auto puis fallback bouton manuel OK
- Sub native créée + register OneSignal OK
- player_id enregistré : 958c121b-446f-4e2d-ae4d-cee31a320467
- Dans OneSignal : type "Safari", subscribed=yes

## Ce qui ne marche pas
- Notif test envoyée depuis OneSignal → status "Delivered" 
  mais n'arrive jamais sur l'iPhone
- iOS settings tous OK (Sleep off, permissions allow, PWA 
  installée home screen, app pas en foreground)

## Hypothèse à tester demain
L'endpoint stocké chez OneSignal est peut-être un endpoint Mac 
Safari (test précédent) au lieu de l'endpoint iPhone PWA.

## Plan pour demain matin
1. Supprimer PWA PaceRank du home screen iPhone
2. Effacer historique + cache Safari iOS
3. Rouvrir pacerank.vercel.app dans Safari iPhone
4. Réinstaller PWA sur home screen
5. Lancer depuis l'icône → réautoriser notifs
6. Vérifier qu'une nouvelle sub apparaît dans OneSignal 
   (player_id différent de 958c121b...)
7. Renvoyer notif test sur la nouvelle sub

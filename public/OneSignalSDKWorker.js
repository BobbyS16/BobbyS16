// SW unifié — gère à la fois OneSignal push et workbox precache.
//
// OneSignal v16 enregistre ce fichier (path hardcodé). On y importe :
//   1. Le SDK push OneSignal
//   2. Le SW workbox généré par vite-pwa (precache + navigation routing)
//
// vite-pwa est configuré avec `injectRegister: false` pour qu'il n'enregistre
// PAS /sw.js séparément. Sans ça les deux SWs se battent pour le scope `/`,
// vite-pwa gagne, OneSignal disparaît, et les pushs iOS sont droppés
// silencieusement (lock screen muet alors que OneSignal dit "Delivered").
importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");
importScripts("/sw.js");

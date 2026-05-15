import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      // injectRegister: false — on n'enregistre PAS /sw.js séparément. Sinon
      // il écrase /OneSignalSDKWorker.js (même scope `/`) et OneSignal ne
      // peut plus réceptionner les pushs iOS → drop silencieux du lock screen.
      // À la place, OneSignalSDKWorker.js importe /sw.js (cf. public/OneSignalSDKWorker.js)
      // pour avoir un seul SW unifié qui gère push + workbox precache.
      injectRegister: false,
      manifest: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2}'],
      },
      includeAssets: [
        'icon.svg',
        'favicon.svg',
        'apple-touch-icon.png',
        'icons/*.png',
      ],
    }),
  ],
})

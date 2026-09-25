import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Link previews (Open Graph) need absolute URLs. %SITE_URL% in index.html becomes
 * VITE_SITE_URL, e.g. https://hamsa-seven.vercel.app; without it, links stay relative.
 */
function siteUrl(url: string): Plugin {
  return {
    name: 'hamsa-site-url',
    transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', url.replace(/\/$/, '')),
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    plugins: [
      react(),
      tailwindcss(),
      siteUrl(env.VITE_SITE_URL ?? ''),
      VitePWA({
        // Our own service worker (src/sw.ts), with the app's files listed in by Workbox.
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        // New versions wait for the "Reload" prompt instead of swapping mid-conversation.
        registerType: 'prompt',
        injectRegister: false,
        // public/manifest.webmanifest is the manifest.
        manifest: false,
        injectManifest: {
          // A classic script: works in every browser with service workers (module workers don't everywhere).
          rollupFormat: 'iife',
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          // Big landing-page pictures load from the network, not the offline copy.
          globIgnores: ['screenshots/**', 'og-image.png'],
        },
      }),
    ],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
  }
})

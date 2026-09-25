import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react()],
    resolve: {
      // These browser exports require DOM APIs, which the preview worker lacks.
      alias: {
        'decode-named-character-reference': fileURLToPath(new URL('./node_modules/decode-named-character-reference/index.js', import.meta.url)),
        'hast-util-from-html-isomorphic': fileURLToPath(new URL('./node_modules/hast-util-from-html-isomorphic/index.js', import.meta.url))
      }
    }
  }
})

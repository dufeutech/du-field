import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

// The project ships a pure vanilla JS + nanostores library built from `lib/index.ts`.
// Preact is only used for the local dev playground (`npm run dev`) and is NOT part
// of the published library.
// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // Preact powers the dev playground only; the library build stays vanilla.
  plugins: command === 'serve' ? [preact()] : [],
  build: {
    lib: {
      entry: resolve(import.meta.dirname, 'lib/index.ts'),
      name: 'DuField',
      // `es`  -> dist/index.mjs       (ES modules / bundlers)
      // `iife` -> dist/index.iife.js  (drop-in <script> for the browser)
      formats: ['es', 'iife'],
      fileName: (format) => (format === 'es' ? 'index.mjs' : 'index.iife.js'),
    },
    // nanostores is bundled into both outputs (nothing is left external),
    // so the library is fully self-contained.
    emptyOutDir: true,
    // The library dist should only contain build artifacts, not the dev
    // playground's static assets.
    copyPublicDir: false,
  },
}))

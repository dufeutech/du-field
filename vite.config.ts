import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

// The project ships a pure vanilla JS + nanostores library built from `lib/index.ts`.
// Preact is only used for the local dev playground (`npm run dev`) and is NOT part
// of the published library.
// https://vite.dev/config/
// The waria component library lives in a sibling repo and is not published to
// this project's node_modules. For the dev playground only, alias its package
// name to its source entry so `import { App } from '@dufeut/waria'` resolves.
// This affects `npm run dev` only — the library build (lib/index.ts) imports no
// waria code, so the published artifact stays dependency-free.
const wariaSrc = resolve(import.meta.dirname, '../waria/src/index.ts')

export default defineConfig(({ command }) => ({
  // Preact powers the dev playground only; the library build stays vanilla.
  plugins: command === 'serve' ? [preact()] : [],
  // Harmless during the library build (lib/index.ts imports no waria); only the
  // dev playground actually resolves this specifier.
  resolve: {
    alias: { '@dufeut/waria': wariaSrc },
  },
  server: {
    // Allow Vite to read the sibling waria source during dev.
    fs: { allow: [resolve(import.meta.dirname, '..')] },
  },
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

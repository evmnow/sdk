import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

// Multi-entry library build. Rollup's `preserveModules` keeps the src/ tree
// 1:1 in dist/, so each source file becomes an independently importable
// subpath under `@evmnow/sdk/...` (declared in package.json#exports).
export default defineConfig({
  build: {
    minify: false,
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
    },
    rollupOptions: {
      external: [
        '@1001-digital/proxies',
        '@1001-digital/natspec',
        '@noble/hashes/sha3',
      ],
      output: {
        preserveModules: true,
        preserveModulesRoot: 'src',
        entryFileNames: '[name].js',
      },
    },
  },
  plugins: [
    dts({ exclude: ['test'] }),
  ],
})

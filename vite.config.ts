import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

// Multi-entry library build. Rollup's `preserveModules` keeps the src/ tree
// 1:1 in dist/, so each source file becomes an independently importable
// subpath under `@evmnow/sdk/...` (declared in package.json#exports).
// Every subpath in package.json#exports is an explicit entry so a module
// keeps being emitted even if the barrel ever stops re-exporting it.
export default defineConfig({
  build: {
    minify: false,
    lib: {
      entry: [
        resolve(__dirname, 'src/index.ts'),
        resolve(__dirname, 'src/actions.ts'),
        resolve(__dirname, 'src/merge.ts'),
        resolve(__dirname, 'src/format.ts'),
        resolve(__dirname, 'src/natspec.ts'),
        resolve(__dirname, 'src/token.ts'),
        resolve(__dirname, 'src/intent.ts'),
        resolve(__dirname, 'src/validate.ts'),
        resolve(__dirname, 'src/uri.ts'),
        resolve(__dirname, 'src/ens.ts'),
        resolve(__dirname, 'src/rpc.ts'),
        resolve(__dirname, 'src/errors.ts'),
        resolve(__dirname, 'src/interfaces/detect.ts'),
        resolve(__dirname, 'src/interfaces/erc20.ts'),
        resolve(__dirname, 'src/interfaces/erc721.ts'),
        resolve(__dirname, 'src/sources/repository.ts'),
        resolve(__dirname, 'src/sources/contract-uri.ts'),
        resolve(__dirname, 'src/sources/sourcify.ts'),
        resolve(__dirname, 'src/sources/proxy.ts'),
      ],
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

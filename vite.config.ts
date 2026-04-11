import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

export default defineConfig({
  build: {
    minify: false,
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      external: [
        '@1001-digital/natspec',
        '@noble/hashes/sha3',
      ],
    },
  },
  plugins: [
    dts({ rollupTypes: true, exclude: ['test'] }),
  ],
})

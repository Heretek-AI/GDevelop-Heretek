import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [
          // Support for Flow syntax in legacy JS files
          '@babel/plugin-syntax-flow',
          '@babel/plugin-transform-flow-strip-types',
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      src: path.resolve(__dirname, './src'),
    },
  },
  publicDir: 'public',
  server: {
    port: 3000,
    open: false,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  worker: {
    format: 'es',
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
  },
});

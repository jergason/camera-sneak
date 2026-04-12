import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/camera-sneak/' : '/',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        'camera-sneak': resolve(__dirname, 'camera-sneak/index.html'),
        'void-marine': resolve(__dirname, 'void-marine/index.html'),
      },
    },
  },
});

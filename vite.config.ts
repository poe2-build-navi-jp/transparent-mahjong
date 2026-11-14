import { defineConfig } from 'vite';

// GitHub Pages などサブパスでも動くよう相対パスでビルドする
export default defineConfig({
  base: './',
  build: { target: 'es2020' },
});

import { defineConfig } from 'vite';

// Relative asset paths so the build works both at a domain root (Vercel)
// and under a sub-path (GitHub Pages: /8mu-demo/).
export default defineConfig({
  base: './'
});

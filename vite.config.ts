import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Two build targets:
//   default            multi-file build in dist/ (the Electron app loads it from app://game/)
//   --mode artifact    one self-contained HTML file in dist-artifact/ (the hosted web version)
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'artifact' ? [viteSingleFile()] : [],
  // Babylon.js ships native ES modules imported by deep path. Pre-bundling them makes the dev server
  // re-optimize (and force a reload) every time a new Babylon module is imported.
  optimizeDeps: { exclude: ['@babylonjs/core', '@babylonjs/loaders', '@babylonjs/materials'] },
  build: {
    target: 'es2022',
    outDir: mode === 'artifact' ? 'dist-artifact' : 'dist',
    chunkSizeWarningLimit: 4000,
  },
}));

import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Two build targets:
//   default            multi-file build in dist/ (the Electron app loads it from app://game/)
//   --mode artifact    one self-contained HTML file in dist-artifact/ (the hosted web version)
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'artifact' ? [viteSingleFile()] : [],
  build: {
    target: 'es2022',
    outDir: mode === 'artifact' ? 'dist-artifact' : 'dist',
    chunkSizeWarningLimit: 4000,
  },
}));

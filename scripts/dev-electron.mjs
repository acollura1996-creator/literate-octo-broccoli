// `npm run dev:electron`: start the Vite dev server, compile the Electron main/preload scripts,
// then launch Electron against the dev server. Works the same on Windows, macOS and Linux.
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const electronPath = require('electron'); // the electron package exports its binary path

const build = spawnSync(process.execPath, ['scripts/build-electron.mjs'], { stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

const server = await createServer({ server: { port: 5173, strictPort: false } });
await server.listen();
const url = server.resolvedUrls?.local?.[0] ?? 'http://localhost:5173/';
console.log(`[dev:electron] Vite running at ${url}`);

const extra = process.argv.slice(2); // e.g. --no-sandbox when running as root in CI containers
const child = spawn(electronPath, ['.', ...extra], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url.replace(/\/$/, '/') },
});
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});

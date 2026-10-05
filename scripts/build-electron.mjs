// Compile electron/*.ts to dist-electron/ as CommonJS. The project's package.json is
// "type": "module", so dist-electron gets its own package.json marking it CommonJS (Electron's
// sandboxed preload scripts must be CommonJS).
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const r = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'electron'], { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status ?? 1);
writeFileSync('dist-electron/package.json', JSON.stringify({ type: 'commonjs' }, null, 2) + '\n');

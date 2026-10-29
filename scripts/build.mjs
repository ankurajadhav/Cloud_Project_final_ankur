import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const outDir = path.join(rootDir, 'dist');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, 'src'), { recursive: true });
fs.copyFileSync(path.join(rootDir, 'server.ts'), path.join(outDir, 'server.ts'));
for (const filename of fs.readdirSync(path.join(rootDir, 'src')).filter((name) => name.endsWith('.ts'))) {
  fs.copyFileSync(path.join(rootDir, 'src', filename), path.join(outDir, 'src', filename));
}
fs.writeFileSync(path.join(outDir, 'BUILD_INFO.json'), JSON.stringify({
  name: 'Healthcare Fraud Intelligence',
  version: '2.3.12',
  source: 'server.ts + src/*.ts',
  runtime: 'Node.js 22.13+ with --experimental-strip-types',
  built_at: new Date().toISOString(),
}, null, 2) + '\n');
console.log('Production source build copied to dist/. Run with: npm start');

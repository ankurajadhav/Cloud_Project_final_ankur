import fs from 'node:fs';
import path from 'node:path';

if (process.env.NODE_ENV === 'production') throw new Error('Refusing to reset a production database.');
if (!process.argv.includes('--confirm-reset')) throw new Error('Explicit confirmation required: npm run db:reset -- --confirm-reset');
const source = path.resolve(process.env.HFI_DB_PATH || path.join(process.cwd(), 'data', 'healthcare-fraud.sqlite'));
for (const file of [source, `${source}-wal`, `${source}-shm`]) {
  if (fs.existsSync(file)) fs.rmSync(file, { force: true });
}
console.log(`Development database files removed at ${source}. Restart npm run dev to import the synthetic seed data.`);

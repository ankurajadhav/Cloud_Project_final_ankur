import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = process.cwd();
const source = path.resolve(process.env.HFI_DB_PATH || path.join(root, 'data', 'healthcare-fraud.sqlite'));
if (!fs.existsSync(source)) throw new Error(`Database does not exist: ${source}. Start the application once to initialize it.`);
const arg = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : `backups/healthcare-fraud-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`;
const destination = path.resolve(root, arg);
if (source === destination) throw new Error('Backup destination must differ from the source database.');
fs.mkdirSync(path.dirname(destination), { recursive: true });
if (fs.existsSync(destination)) throw new Error(`Backup destination already exists: ${destination}`);
const db = new DatabaseSync(source);
try {
  db.exec('PRAGMA wal_checkpoint(FULL);');
  const quoted = destination.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${quoted}'`);
} finally { db.close(); }
console.log(`Consistent SQLite backup written to ${destination}`);

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDatabase, initDatabase } from '../src/database.ts';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('an intentionally emptied initialized database is not reseeded after restart', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hfi-empty-db-'));
  const dbPath = path.join(tempDir, 'hfi.sqlite');
  try {
    const first = initDatabase({ dbPath, seedDataDir: path.join(projectRoot, 'data') });
    assert.equal(Number(first.prepare('SELECT COUNT(*) AS n FROM providers').get().n), 30);
    assert.equal(first.prepare("SELECT value FROM metadata WHERE key='seed_initialized'").get()?.value, '1');

    first.exec('BEGIN IMMEDIATE;');
    try {
      first.exec('DELETE FROM investigation_notes; DELETE FROM investigations; DELETE FROM claims; DELETE FROM referrals; DELETE FROM providers; DELETE FROM audit_events; DELETE FROM analytical_snapshots;');
      first.exec('COMMIT;');
    } catch (error) {
      first.exec('ROLLBACK;');
      throw error;
    }
    closeDatabase();

    const restarted = initDatabase({ dbPath, seedDataDir: path.join(projectRoot, 'data') });
    assert.equal(Number(restarted.prepare('SELECT COUNT(*) AS n FROM providers').get().n), 0);
    assert.equal(Number(restarted.prepare('SELECT COUNT(*) AS n FROM claims').get().n), 0);
    assert.equal(Number(restarted.prepare('SELECT COUNT(*) AS n FROM referrals').get().n), 0);
    assert.equal(restarted.prepare("SELECT value FROM metadata WHERE key='seed_initialized'").get()?.value, '1');
  } finally {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

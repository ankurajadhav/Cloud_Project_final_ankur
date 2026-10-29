import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { getSchemaVersion, migrateDatabase } from '../src/migrations.ts';

test('fresh databases run all schema migrations and repeat safely', () => {
  const db = new DatabaseSync(':memory:');
  try {
    assert.equal(migrateDatabase(db), 3);
    assert.equal(getSchemaVersion(db), 3);
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map((row) => row.name);
    for (const name of ['providers', 'claims', 'referrals', 'investigations', 'investigation_notes', 'audit_events', 'analytical_snapshots', 'metadata']) assert.ok(names.includes(name));
    assert.equal(migrateDatabase(db), 3, 'applying migrations again must be idempotent');
  } finally { db.close(); }
});

test('existing version-1 databases receive missing indexes and claim-linked referral migration safely', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO metadata(key,value) VALUES('schema_version','1');
      CREATE TABLE investigation_notes (note_id TEXT PRIMARY KEY, case_id TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE claims (claim_id TEXT PRIMARY KEY);
      CREATE TABLE referrals (referral_id TEXT PRIMARY KEY, from_provider TEXT NOT NULL, to_provider TEXT NOT NULL);`);
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_notes_case'").get(), undefined);
    assert.equal(migrateDatabase(db), 3);
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_notes_case'").get());
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_referrals_source_claim'").get());
    assert.ok((db.prepare("PRAGMA table_info(referrals)").all() as any[]).some((column) => column.name === 'source_claim_id'));
    assert.equal(Number(db.prepare("SELECT value FROM metadata WHERE key='schema_version'").get()?.value), 3);
  } finally { db.close(); }
});


test('refuses a database schema version newer than the application supports', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO metadata(key,value) VALUES('schema_version','99');");
    assert.throws(() => migrateDatabase(db), /newer than this application supports/);
  } finally { db.close(); }
});

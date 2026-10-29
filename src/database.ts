import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getSchemaVersion as readSchemaVersion, migrateDatabase } from "./migrations.ts";

export type DatabaseOptions = { dbPath?: string; seedDataDir?: string; seed?: boolean };
let database: DatabaseSync | null = null;
let activeDbPath = "";

export function initDatabase(options: DatabaseOptions = {}): DatabaseSync {
  if (database) return database;
  const dbPath = options.dbPath || process.env.HFI_DB_PATH || path.join(process.cwd(), "data", "healthcare-fraud.sqlite");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  database = new DatabaseSync(dbPath);
  activeDbPath = dbPath;
  database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");
  migrateDatabase(database);
  database.prepare("INSERT OR IGNORE INTO metadata(key,value) VALUES('data_version','0')").run();

  const providerCount = Number(database.prepare("SELECT COUNT(*) AS n FROM providers").get().n);
  const claimCount = Number(database.prepare("SELECT COUNT(*) AS n FROM claims").get().n);
  const referralCount = Number(database.prepare("SELECT COUNT(*) AS n FROM referrals").get().n);
  if (providerCount === 0 && (claimCount > 0 || referralCount > 0)) {
    throw new Error("Database integrity error: claims/referrals exist without providers. No seed data was written.");
  }

  // Distinguish a genuinely new database from one whose records were intentionally
  // deleted. Older populated databases are marked during upgrade; retained audit or
  // snapshot history also proves that an empty core dataset is not a first startup.
  const historicalCount = Number(database.prepare(`SELECT
    (SELECT COUNT(*) FROM investigations) +
    (SELECT COUNT(*) FROM investigation_notes) +
    (SELECT COUNT(*) FROM audit_events) +
    (SELECT COUNT(*) FROM analytical_snapshots) AS n`).get().n);
  const previouslyInitialized = database.prepare("SELECT value FROM metadata WHERE key='seed_initialized'").get()?.value === "1";
  const hasAnyCoreRecords = providerCount > 0 || claimCount > 0 || referralCount > 0;
  if (hasAnyCoreRecords || historicalCount > 0) {
    database.prepare("INSERT OR IGNORE INTO metadata(key,value) VALUES('seed_initialized','1')").run();
  }
  const isSeedInitialized = previouslyInitialized || hasAnyCoreRecords || historicalCount > 0;
  if (!hasAnyCoreRecords && options.seed !== false && !isSeedInitialized) {
    seedInitialData(database, options.seedDataDir || path.join(process.cwd(), "data"));
  }
  return database;
}

function seedInitialData(db: DatabaseSync, dataDir: string): void {
  const providers = JSON.parse(fs.readFileSync(path.join(dataDir, "providers.json"), "utf8"));
  const claims = JSON.parse(fs.readFileSync(path.join(dataDir, "claims.json"), "utf8"));
  const referrals = JSON.parse(fs.readFileSync(path.join(dataDir, "referrals.json"), "utf8"));
  if (!Array.isArray(providers) || !Array.isArray(claims) || !Array.isArray(referrals)) throw new Error("Seed JSON files must each contain an array.");
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE;");
  try {
    const insertProvider = db.prepare("INSERT INTO providers(provider_id,provider_name,specialty,city,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)");
    for (const p of providers) insertProvider.run(p.provider_id, p.provider_name, p.specialty, p.city, "ACTIVE", now, now);
    const insertClaim = db.prepare("INSERT INTO claims(claim_id,provider_id,patient_id,procedure_code,claim_amount,claim_date,specialty,referred_to,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)");
    for (const c of claims) insertClaim.run(c.claim_id, c.provider_id, c.patient_id, c.procedure_code, c.claim_amount, c.claim_date, c.specialty || "Unspecified", c.referred_to || null, now, now);
    const insertReferral = db.prepare("INSERT INTO referrals(referral_id,from_provider,to_provider,reason,event_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?)");
    for (const r of referrals) insertReferral.run(r.referral_id, r.from_provider, r.to_provider, r.reason || "unspecified", r.event_date || null, now, now);
    db.prepare("UPDATE metadata SET value='1' WHERE key='data_version'").run();
    db.prepare("INSERT INTO metadata(key,value) VALUES('seed_initialized','1') ON CONFLICT(key) DO UPDATE SET value='1'").run();
    db.prepare("INSERT INTO audit_events(event_id,occurred_at,entity_type,entity_id,operation,before_json,after_json) VALUES(?,?,?,?,?,?,?)")
      .run("EVT-SEED-INITIAL", now, "dataset", "synthetic-demo", "INITIAL_SEED", null, JSON.stringify({ providers: providers.length, claims: claims.length, referrals: referrals.length, source: "data/*.json", synthetic: true }));
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

export function getDatabase(): DatabaseSync {
  if (!database) return initDatabase();
  return database;
}
export function getDatabasePath(): string { return activeDbPath; }
export function getSchemaVersion(db = getDatabase()): number { return readSchemaVersion(db); }
export function closeDatabase(): void { if (database) database.close(); database = null; activeDbPath = ""; }
export function timestamp(): string { return new Date().toISOString(); }
export function newId(prefix: string): string { return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`; }
export function getDataVersion(db = getDatabase()): number { return Number(db.prepare("SELECT value FROM metadata WHERE key='data_version'").get()?.value || 0); }
export function setDataVersion(value: number, db = getDatabase()): void { db.prepare("UPDATE metadata SET value=? WHERE key='data_version'").run(String(value)); }

export function readProviders(db = getDatabase()): any[] { return db.prepare("SELECT * FROM providers ORDER BY provider_id").all(); }
export function readClaims(db = getDatabase()): any[] { return db.prepare("SELECT claim_id,provider_id,patient_id,procedure_code,claim_amount,claim_date,specialty,referred_to,created_at,updated_at FROM claims ORDER BY claim_date DESC,claim_id").all(); }
export function readReferrals(db = getDatabase()): any[] { return db.prepare("SELECT * FROM referrals ORDER BY referral_id").all(); }
export function readInvestigations(db = getDatabase()): any[] { return db.prepare(`SELECT i.*,p.provider_name FROM investigations i JOIN providers p ON p.provider_id=i.provider_id ORDER BY i.updated_at DESC`).all(); }
export function readNotes(caseId?: string, db = getDatabase()): any[] {
  return caseId
    ? db.prepare("SELECT * FROM investigation_notes WHERE case_id=? ORDER BY created_at DESC").all(caseId)
    : db.prepare("SELECT * FROM investigation_notes ORDER BY created_at DESC").all();
}
export function readAudit(limit = 100, entityType?: string, entityId?: string, db = getDatabase()): any[] {
  const filters: string[] = [];
  const params: (string | number)[] = [];
  if (entityType) { filters.push("entity_type=?"); params.push(entityType); }
  if (entityId) { filters.push("entity_id=?"); params.push(entityId); }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  return db.prepare(`SELECT * FROM audit_events ${where} ORDER BY occurred_at DESC LIMIT ?`).all(...params, limit);
}
export function readSnapshots(db = getDatabase()): any[] { return db.prepare("SELECT snapshot_id,data_version,model_version,calculated_at,summary_json,scores_json FROM analytical_snapshots ORDER BY data_version ASC, calculated_at ASC, snapshot_id ASC").all(); }
export function recordAudit(event: { entityType: string; entityId: string; operation: string; before?: unknown; after?: unknown }, db = getDatabase()): void {
  db.prepare("INSERT INTO audit_events(event_id,occurred_at,entity_type,entity_id,operation,before_json,after_json) VALUES(?,?,?,?,?,?,?)")
    .run(newId("EVT"), timestamp(), event.entityType, event.entityId, event.operation,
      event.before === undefined ? null : JSON.stringify(event.before), event.after === undefined ? null : JSON.stringify(event.after));
}
export function recordSnapshot(dataVersion: number, modelVersion: string, calculatedAt: string, summary: unknown, scores: unknown, db = getDatabase()): void {
  db.prepare("INSERT OR REPLACE INTO analytical_snapshots(snapshot_id,data_version,model_version,calculated_at,summary_json,scores_json) VALUES(?,?,?,?,?,?)")
    .run(newId("SNAP"), dataVersion, modelVersion, calculatedAt, JSON.stringify(summary), JSON.stringify(scores));
}

export function runInTransaction<T>(work: () => T, db = getDatabase()): T {
  db.exec("BEGIN IMMEDIATE;");
  try { const result = work(); db.exec("COMMIT;"); return result; }
  catch (error) { try { db.exec("ROLLBACK;"); } catch { /* original failure wins */ } throw error; }
}

import type { DatabaseSync } from "node:sqlite";

type Migration = { version: number; name: string; up: (db: DatabaseSync) => void };

// Apply migrations sequentially and record each version in the same SQLite transaction.
// Existing installations receive only pending schema migrations; migrations never reseed or overwrite stored records.
const migrations: Migration[] = [
  {
    version: 1,
    name: "initial_schema",
    up: (db) => db.exec(`
    CREATE TABLE IF NOT EXISTS providers (
      provider_id TEXT PRIMARY KEY CHECK(length(provider_id) BETWEEN 2 AND 32),
      provider_name TEXT NOT NULL CHECK(length(trim(provider_name)) BETWEEN 1 AND 120),
      specialty TEXT NOT NULL CHECK(length(trim(specialty)) BETWEEN 1 AND 60),
      city TEXT NOT NULL CHECK(length(trim(city)) BETWEEN 1 AND 100),
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_providers_specialty ON providers(specialty);
    CREATE INDEX IF NOT EXISTS idx_providers_status ON providers(status);
    CREATE TABLE IF NOT EXISTS claims (
      claim_id TEXT PRIMARY KEY CHECK(length(claim_id) BETWEEN 2 AND 40),
      provider_id TEXT NOT NULL REFERENCES providers(provider_id) ON UPDATE CASCADE ON DELETE RESTRICT,
      patient_id TEXT NOT NULL CHECK(length(trim(patient_id)) BETWEEN 1 AND 80),
      procedure_code TEXT NOT NULL CHECK(length(trim(procedure_code)) BETWEEN 1 AND 80),
      claim_amount REAL NOT NULL CHECK(claim_amount >= 0 AND claim_amount <= 1000000000),
      claim_date TEXT NOT NULL CHECK(length(claim_date) = 10),
      specialty TEXT NOT NULL CHECK(length(trim(specialty)) BETWEEN 1 AND 60),
      referred_to TEXT REFERENCES providers(provider_id) ON UPDATE CASCADE ON DELETE RESTRICT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_claims_provider_date ON claims(provider_id, claim_date);
    CREATE INDEX IF NOT EXISTS idx_claims_specialty_date ON claims(specialty, claim_date);
    CREATE INDEX IF NOT EXISTS idx_claims_date ON claims(claim_date);
    CREATE TABLE IF NOT EXISTS referrals (
      referral_id TEXT PRIMARY KEY CHECK(length(referral_id) BETWEEN 2 AND 40),
      from_provider TEXT NOT NULL REFERENCES providers(provider_id) ON UPDATE CASCADE ON DELETE RESTRICT,
      to_provider TEXT NOT NULL REFERENCES providers(provider_id) ON UPDATE CASCADE ON DELETE RESTRICT,
      reason TEXT NOT NULL DEFAULT 'unspecified' CHECK(length(trim(reason)) BETWEEN 1 AND 160),
      event_date TEXT CHECK(event_date IS NULL OR length(event_date) = 10),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_referrals_source ON referrals(from_provider);
    CREATE INDEX IF NOT EXISTS idx_referrals_target ON referrals(to_provider);
    CREATE INDEX IF NOT EXISTS idx_referrals_pair ON referrals(from_provider,to_provider);
    CREATE TABLE IF NOT EXISTS investigations (
      case_id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL REFERENCES providers(provider_id) ON UPDATE CASCADE ON DELETE RESTRICT,
      title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 180),
      status TEXT NOT NULL DEFAULT 'PENDING REVIEW' CHECK(status IN ('PENDING REVIEW','UNDER INVESTIGATION','RESOLVED','DISMISSED')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_investigations_provider ON investigations(provider_id);
    CREATE INDEX IF NOT EXISTS idx_investigations_status ON investigations(status);
    CREATE TABLE IF NOT EXISTS investigation_notes (
      note_id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL REFERENCES investigations(case_id) ON UPDATE CASCADE ON DELETE RESTRICT,
      body TEXT NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 5000),
      created_by TEXT NOT NULL DEFAULT 'Local investigator' CHECK(length(trim(created_by)) BETWEEN 1 AND 100),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      event_id TEXT PRIMARY KEY,
      occurred_at TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_events(entity_type, entity_id, occurred_at);
    CREATE TABLE IF NOT EXISTS analytical_snapshots (
      snapshot_id TEXT PRIMARY KEY,
      data_version INTEGER NOT NULL,
      model_version TEXT NOT NULL,
      calculated_at TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      scores_json TEXT NOT NULL,
      UNIQUE(data_version, model_version)
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_time ON analytical_snapshots(calculated_at);
    `),
  },
  {
    version: 2,
    name: "investigation_notes_index",
    up: (db) => db.exec("CREATE INDEX IF NOT EXISTS idx_notes_case ON investigation_notes(case_id, created_at);"),
  },
  {
    version: 3,
    name: "claim_linked_referral_events",
    up: (db) => {
      const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((row) => row.name));
      if (!tables.has("claims") || !tables.has("referrals")) throw new Error("Claims and referrals tables must exist before linking referral events to claims.");
      const columns = new Set((db.prepare("PRAGMA table_info(referrals)").all() as { name: string }[]).map((row) => row.name));
      if (!columns.has("source_claim_id")) db.exec("ALTER TABLE referrals ADD COLUMN source_claim_id TEXT REFERENCES claims(claim_id) ON UPDATE CASCADE ON DELETE SET NULL;");
      db.exec("CREATE INDEX IF NOT EXISTS idx_referrals_source_claim ON referrals(source_claim_id);");
    },
  },
];

export function migrateDatabase(db: DatabaseSync): number {
  db.exec(`CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  let current = Number(db.prepare("SELECT value FROM metadata WHERE key='schema_version'").get()?.value || 0);
  const latestSupportedVersion = migrations.at(-1)?.version || 0;
  if (!Number.isInteger(current) || current < 0) throw new Error(`Invalid database schema version: ${current}.`);
  if (current > latestSupportedVersion) throw new Error(`Database schema version ${current} is newer than this application supports (maximum ${latestSupportedVersion}); upgrade the application or use a compatible database backup.`);
  for (const migration of migrations) {
    if (migration.version <= current) continue;
    db.exec("BEGIN IMMEDIATE;");
    try {
      migration.up(db);
      db.prepare("INSERT INTO metadata(key,value) VALUES('schema_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(migration.version));
      db.exec("COMMIT;");
      current = migration.version;
    } catch (error) {
      try { db.exec("ROLLBACK;"); } catch { /* preserve migration failure */ }
      throw new Error(`Database migration ${migration.version} (${migration.name}) failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return current;
}

export function getSchemaVersion(db: DatabaseSync): number {
  return Number(db.prepare("SELECT value FROM metadata WHERE key='schema_version'").get()?.value || 0);
}

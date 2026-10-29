import express, { type Request, type Response, type NextFunction } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { calculateAnalytics } from "./src/analytics.ts";
import { MODEL_VERSION } from "./src/scoring.ts";
import {
  initDatabase, getDatabase, getDatabasePath, getSchemaVersion, getDataVersion, setDataVersion,
  readProviders, readClaims, readReferrals, readInvestigations, readNotes, readAudit, readSnapshots,
  recordAudit, recordSnapshot, runInTransaction, timestamp, newId,
} from "./src/database.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.basename(__dirname).toLowerCase() === "dist" ? path.resolve(__dirname, "..") : __dirname;
const frontendDir = path.join(rootDir, "frontend");
const SPECIALTIES = ["Cardiology", "General Medicine", "Orthopedics", "Dermatology", "Neurology", "Other"];
const CASE_STATUSES = ["PENDING REVIEW", "UNDER INVESTIGATION", "RESOLVED", "DISMISSED"];
const RISK_LEVELS = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INSUFFICIENT DATA"];
const db = initDatabase({ dbPath: process.env.HFI_DB_PATH || undefined, seedDataDir: process.env.HFI_SEED_DATA_DIR || path.join(rootDir, "data") });

type AnalyticsState = { analytics: any | null; error: string | null; updatedAt: string | null };
const analyticsState: AnalyticsState = { analytics: null, error: null, updatedAt: null };

function buildAnalytics(dataVersion = getDataVersion()) {
  return calculateAnalytics({ providers: readProviders(db), claims: readClaims(db), referrals: readReferrals(db), cases: readInvestigations(db), dataVersion });
}
function refreshAnalytics(saveSnapshot: boolean): any {
  const next = buildAnalytics();
  if (saveSnapshot) recordSnapshot(next.summary.data_version, MODEL_VERSION, next.summary.calculated_at, next.summary, next.providers.map((p: any) => ({
    provider_id: p.provider_id, risk_score: p.risk_score, risk_level: p.risk_level,
    statistical_risk: p.statistical_risk, referral_ring_risk: p.referral_ring_risk,
    network_risk: p.network_risk, behaviour_risk: p.behaviour_risk,
  })), db);
  analyticsState.analytics = next;
  analyticsState.error = null;
  analyticsState.updatedAt = next.summary.calculated_at;
  return next;
}

try {
  const current = buildAnalytics();
  analyticsState.analytics = current;
  analyticsState.updatedAt = current.summary.calculated_at;
  const matching = readSnapshots(db).some((snapshot: any) => Number(snapshot.data_version) === current.summary.data_version && snapshot.model_version === MODEL_VERSION);
  if (!matching) recordSnapshot(current.summary.data_version, MODEL_VERSION, current.summary.calculated_at, current.summary, current.providers.map((p: any) => ({ provider_id: p.provider_id, risk_score: p.risk_score, risk_level: p.risk_level })), db);
} catch (error) {
  analyticsState.analytics = null;
  analyticsState.error = error instanceof Error ? error.message : "Unknown analytics error";
  console.error("Initial analytics calculation failed. Live analytics are unavailable; demo results will not be substituted.", error);
}

class HttpError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }
const now = () => timestamp();
function text(value: unknown, name: string, min = 1, max = 120, optional = false): string | null {
  if ((value === undefined || value === null || value === "") && optional) return null;
  if (typeof value !== "string") throw new HttpError(400, `${name} must be a string.`);
  const result = value.trim();
  if (result.length < min || result.length > max) throw new HttpError(400, `${name} must contain ${min}-${max} characters.`);
  return result;
}
function validateDate(value: unknown, name: string, optional = false): string | null {
  if ((value === undefined || value === null || value === "") && optional) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, `${name} must be a valid date in YYYY-MM-DD format.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new HttpError(400, `${name} is not a valid calendar date.`);
  return value;
}
function validateAmount(value: unknown): number {
  if (typeof value !== "number" && typeof value !== "string") throw new HttpError(400, "claim_amount must be a finite number representing the amount billed.");
  if (typeof value === "string" && value.trim() === "") throw new HttpError(400, "claim_amount must be a finite number representing the amount billed.");
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000) throw new HttpError(400, "claim_amount must be between 0 and 1,000,000,000.");
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}
function validateProviderId(value: unknown, name = "provider_id"): string {
  const id = text(value, name, 2, 32)!;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) throw new HttpError(400, `${name} may contain only letters, digits, underscores, and hyphens.`);
  return id;
}
function validateSpecialty(value: unknown): string {
  const specialty = text(value, "specialty", 1, 60)!;
  if (!SPECIALTIES.includes(specialty)) throw new HttpError(400, `specialty must be one of: ${SPECIALTIES.join(", ")}.`);
  return specialty;
}
function getProviderRaw(id: string): any {
  const row = db.prepare("SELECT * FROM providers WHERE provider_id=?").get(id);
  if (!row) throw new HttpError(404, `Provider '${id}' was not found.`);
  return row;
}
function getClaimRaw(id: string): any {
  const row = db.prepare("SELECT * FROM claims WHERE claim_id=?").get(id);
  if (!row) throw new HttpError(404, `Claim '${id}' was not found.`);
  return row;
}
function getReferralRaw(id: string): any {
  const row = db.prepare("SELECT * FROM referrals WHERE referral_id=?").get(id);
  if (!row) throw new HttpError(404, `Referral '${id}' was not found.`);
  return row;
}
function getCaseRaw(id: string): any {
  const row = db.prepare("SELECT * FROM investigations WHERE case_id=?").get(id);
  if (!row) throw new HttpError(404, `Investigation '${id}' was not found.`);
  return row;
}
function assertProviderExists(id: string): any { return getProviderRaw(id); }
function publicClaim(row: any): any {
  if (!row) return row;
  // Patient IDs are synthetic; avoid unnecessarily copying them into audit records.
  const { patient_id, ...rest } = row;
  return { ...rest, patient_id: patient_id ? "[synthetic identifier]" : undefined };
}
function finishInputMutation<T>(entityType: string, entityId: string, operation: string, before: unknown, operationFn: () => T): T {
  let newAnalytics: any;
  let result: T;
  try {
    const outcome = runInTransaction(() => {
      result = operationFn();
      const auditAfter = result instanceof Object ? result : { result };
      recordAudit({ entityType, entityId, operation, before, after: auditAfter }, db);
      const nextVersion = getDataVersion(db) + 1;
      setDataVersion(nextVersion, db);
      try { newAnalytics = buildAnalytics(nextVersion); }
      catch (calculationError) {
        analyticsState.error = `Analytics recalculation failed; the transaction was rolled back: ${calculationError instanceof Error ? calculationError.message : String(calculationError)}`;
        analyticsState.analytics = null;
        analyticsState.updatedAt = null;
        throw calculationError;
      }
      recordSnapshot(nextVersion, MODEL_VERSION, newAnalytics.summary.calculated_at, newAnalytics.summary, newAnalytics.providers.map((p: any) => ({
        provider_id: p.provider_id, risk_score: p.risk_score, risk_level: p.risk_level,
        statistical_risk: p.statistical_risk, referral_ring_risk: p.referral_ring_risk,
        network_risk: p.network_risk, behaviour_risk: p.behaviour_risk,
      })), db);
      return { result, analytics: newAnalytics };
    }, db);
    analyticsState.analytics = outcome.analytics;
    analyticsState.updatedAt = outcome.analytics.summary.calculated_at;
    analyticsState.error = null;
    return outcome.result;
  } catch (error) {
    throw error;
  }
}
function finishCaseMutation<T>(entityType: string, entityId: string, operation: string, before: unknown, operationFn: () => T): T {
  const result = runInTransaction(() => {
    const value = operationFn();
    const auditAfter = entityType === "investigation_note"
      ? { note_id: (value as any)?.note_id, case_id: (value as any)?.case_id, created_by: (value as any)?.created_by, body_length: String((value as any)?.body || "").length }
      : value;
    recordAudit({ entityType, entityId, operation, before, after: auditAfter }, db);
    return value;
  }, db);
  // Case status is not an input to the scoring model but the current overview does show open cases.
  try { const fresh = buildAnalytics(); analyticsState.analytics = fresh; analyticsState.updatedAt = fresh.summary.calculated_at; analyticsState.error = null; }
  catch (error) {
    analyticsState.error = `Analytics refresh failed after the investigation update: ${error instanceof Error ? error.message : String(error)}`;
    analyticsState.analytics = null;
    analyticsState.updatedAt = null;
  }
  return result;
}
function providerAnalytics(id: string): any {
  if (!analyticsState.analytics) throw new HttpError(503, `Analytics are unavailable: ${analyticsState.error || "calculation has not completed"}.`);
  const row = analyticsState.analytics.providers.find((provider: any) => provider.provider_id === id);
  if (!row) throw new HttpError(404, `Provider '${id}' was not found in the current analytical snapshot.`);
  return row;
}
function paged<T>(rows: T[], request: Request): T[] | { items: T[]; total: number; page: number; pageSize: number } {
  const hasPage = request.query.page !== undefined || request.query.pageSize !== undefined;
  if (!hasPage) return rows;
  const page = Math.max(1, Number.parseInt(String(request.query.page || "1"), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(request.query.pageSize || "20"), 10) || 20));
  return { items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize };
}
function sortRows(rows: any[], sort: string | undefined, direction: string | undefined): any[] {
  const allowed = new Set(["provider_id", "provider_name", "specialty", "city", "status", "risk_score", "claim_count", "total_billed_amount", "claim_date", "claim_amount", "referral_id", "from_provider", "to_provider", "created_at", "updated_at"]);
  const key = sort && allowed.has(sort) ? sort : "risk_score";
  const dir = direction?.toLowerCase() === "asc" ? 1 : -1;
  return rows.sort((a, b) => {
    const av = a[key], bv = b[key];
    if (av == null && bv != null) return 1;
    if (bv == null && av != null) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av ?? "").localeCompare(String(bv ?? ""), undefined, { numeric: true, sensitivity: "base" }) * dir;
  });
}
function getRows(req: Request): { q: string; page?: number; pageSize?: number } {
  return { q: String(req.query.q || "").trim().toLowerCase(), page: req.query.page === undefined ? undefined : Math.max(1, Number(req.query.page) || 1), pageSize: req.query.pageSize === undefined ? undefined : Math.min(100, Math.max(1, Number(req.query.pageSize) || 20)) };
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb", strict: true }));
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  // Live analytical endpoints must never be served from a browser/proxy cache.
  // Old cached ring/SCC responses can otherwise make the dashboard look stale after a mutation.
  if (req.path.startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    // Lets the frontend detect if its parallel requests straddled another client's write.
    res.setHeader("X-HFI-Data-Version", String(getDataVersion(db)));
  }
  next();
});

app.get("/api/health", (_req, res) => res.json({ status: analyticsState.analytics ? "ok" : "degraded", storage: "sqlite", database: path.basename(getDatabasePath()), data_version: getDataVersion(db), model_version: MODEL_VERSION, analytics_updated_at: analyticsState.updatedAt, analytics_error: analyticsState.error }));
app.get("/api/meta", (_req, res) => res.json({ specialties: SPECIALTIES, case_statuses: CASE_STATUSES, risk_levels: RISK_LEVELS, schema_version: getSchemaVersion(db), model_version: MODEL_VERSION, data_version: getDataVersion(db), synthetic_data: true }));
app.get("/api/summary", (_req, res) => {
  if (!analyticsState.analytics) return res.status(503).json({ error: "Live analytics are unavailable.", detail: analyticsState.error });
  res.json({ ...analyticsState.analytics.summary, analytics_status: analyticsState.error ? "warning" : "current", analytics_warning: analyticsState.error });
});
app.get("/api/analytics", (_req, res) => {
  if (!analyticsState.analytics) return res.status(503).json({ error: "Live analytics are unavailable.", detail: analyticsState.error });
  res.json(analyticsState.analytics);
});
app.get("/api/trends", (_req, res) => {
  const snapshots = readSnapshots(db).map((snapshot: any) => ({ snapshot_id: snapshot.snapshot_id, data_version: snapshot.data_version, model_version: snapshot.model_version, calculated_at: snapshot.calculated_at, summary: JSON.parse(snapshot.summary_json), scores: JSON.parse(snapshot.scores_json) }));
  const modelVersions = [...new Set(snapshots.map((snapshot: any) => snapshot.model_version))];
  const dataVersions = [...new Set(snapshots.map((snapshot: any) => Number(snapshot.data_version)))];
  const note = snapshots.length > 1
    ? `Stored analytics snapshots: ${snapshots.length} across ${dataVersions.length} data version(s) and ${modelVersions.length} model version(s). A model update can add a snapshot without a data change; compare provider risk scores only when model_version matches. The overview trend deduplicates model-only snapshots because it charts total billed amount.`
    : "Only the current baseline exists. Trend history accumulates after data changes; no historical scores are fabricated.";
  res.json({ snapshots, historical_data_available: dataVersions.length > 1, snapshot_count: snapshots.length, data_version_count: dataVersions.length, model_version_count: modelVersions.length, note });
});

app.get("/api/providers", (req, res) => {
  const filters = getRows(req);
  const risk = String(req.query.risk || "").toUpperCase();
  const status = String(req.query.status || "ALL").toUpperCase();
  let rows = readProviders(db).map((provider: any) => ({ ...provider, ...((analyticsState.analytics?.providers || []).find((p: any) => p.provider_id === provider.provider_id) || {}) }));
  if (risk) rows = rows.filter((row: any) => row.risk_level === risk);
  if (status !== "ALL") rows = rows.filter((row: any) => row.status === status);
  if (filters.q) rows = rows.filter((row: any) => [row.provider_id, row.provider_name, row.specialty, row.city].some((value) => String(value || "").toLowerCase().includes(filters.q)));
  sortRows(rows, String(req.query.sort || "risk_score"), String(req.query.direction || "desc"));
  res.json(paged(rows, req));
});
app.get("/api/providers/:pid", (req, res) => {
  const id = req.params.pid;
  const provider = { ...getProviderRaw(id), ...providerAnalytics(id) };
  const claims = db.prepare("SELECT * FROM claims WHERE provider_id=? ORDER BY claim_date DESC,claim_id LIMIT 250").all(id).map(publicClaim);
  const referrals = db.prepare("SELECT * FROM referrals WHERE from_provider=? OR to_provider=? ORDER BY referral_id").all(id, id);
  const investigations = db.prepare("SELECT * FROM investigations WHERE provider_id=? ORDER BY updated_at DESC").all(id).map((item: any) => ({ ...item, notes: readNotes(item.case_id, db) }));
  res.json({ ...provider, claims, referrals, investigations, audit: readAudit(30, "provider", id, db) });
});
app.post("/api/providers", (req, res) => {
  const id = validateProviderId(req.body?.provider_id);
  const providerName = text(req.body?.provider_name, "provider_name", 1, 120)!;
  const specialty = validateSpecialty(req.body?.specialty);
  const city = text(req.body?.city, "city", 1, 100)!;
  const status = String(req.body?.status || "ACTIVE").toUpperCase();
  if (!["ACTIVE", "INACTIVE"].includes(status)) throw new HttpError(400, "status must be ACTIVE or INACTIVE.");
  const time = now();
  const created = finishInputMutation("provider", id, "CREATE", undefined, () => {
    db.prepare("INSERT INTO providers(provider_id,provider_name,specialty,city,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(id, providerName, specialty, city, status, time, time);
    return getProviderRaw(id);
  });
  res.status(201).json({ ...created, ...providerAnalytics(id) });
});
app.patch("/api/providers/:pid", (req, res) => {
  const id = req.params.pid;
  const before = getProviderRaw(id);
  const providerName = req.body?.provider_name === undefined ? before.provider_name : text(req.body.provider_name, "provider_name", 1, 120)!;
  const specialty = req.body?.specialty === undefined ? before.specialty : validateSpecialty(req.body.specialty);
  const city = req.body?.city === undefined ? before.city : text(req.body.city, "city", 1, 100)!;
  const status = req.body?.status === undefined ? before.status : String(req.body.status).toUpperCase();
  if (!["ACTIVE", "INACTIVE"].includes(status)) throw new HttpError(400, "status must be ACTIVE or INACTIVE.");
  const result = finishInputMutation("provider", id, "UPDATE", before, () => {
    db.prepare("UPDATE providers SET provider_name=?,specialty=?,city=?,status=?,updated_at=? WHERE provider_id=?").run(providerName, specialty, city, status, now(), id);
    return getProviderRaw(id);
  });
  res.json({ ...result, ...providerAnalytics(id) });
});
app.delete("/api/providers/:pid", (req, res) => {
  const id = req.params.pid;
  const before = getProviderRaw(id);
  const result = finishInputMutation("provider", id, "DELETE", before, () => {
    // Investigation cases and their notes are retained as historical evidence. Do not
    // partially delete a provider's operational records if a case prevents deletion.
    const caseCount = Number((db.prepare("SELECT COUNT(*) AS n FROM investigations WHERE provider_id=?").get(id) as any).n);
    if (caseCount > 0) throw new HttpError(409, `Provider '${id}' has ${caseCount} investigation case(s). Deactivate the provider instead; cases and notes are preserved for audit integrity.`);

    // Claims are considered associated when this provider either submitted/billed them
    // or is the legacy referred_to provider. Referral events tied to any such claim are
    // removed alongside events whose source or destination is this provider.
    const claims = db.prepare("SELECT * FROM claims WHERE provider_id=? OR referred_to=? ORDER BY claim_id").all(id, id) as any[];
    const referrals = db.prepare(`SELECT * FROM referrals
      WHERE from_provider=? OR to_provider=?
         OR source_claim_id IN (SELECT claim_id FROM claims WHERE provider_id=? OR referred_to=?)
      ORDER BY referral_id`).all(id, id, id, id) as any[];

    // Keep an audit trail for every cascaded record. Synthetic patient identifiers are
    // deliberately redacted by publicClaim before writing audit JSON.
    for (const claim of claims) {
      recordAudit({
        entityType: "claim", entityId: claim.claim_id, operation: "DELETE_CASCADE",
        before: publicClaim(claim),
        after: { deleted: true, reason: "provider_delete_cascade", provider_id: id },
      }, db);
    }
    for (const referral of referrals) {
      recordAudit({
        entityType: "referral", entityId: referral.referral_id, operation: "DELETE_CASCADE",
        before: referral,
        after: { deleted: true, reason: "provider_delete_cascade", provider_id: id },
      }, db);
    }

    const referralDelete = db.prepare(`DELETE FROM referrals
      WHERE from_provider=? OR to_provider=?
         OR source_claim_id IN (SELECT claim_id FROM claims WHERE provider_id=? OR referred_to=?)`).run(id, id, id, id);
    const claimDelete = db.prepare("DELETE FROM claims WHERE provider_id=? OR referred_to=?").run(id, id);
    db.prepare("DELETE FROM providers WHERE provider_id=?").run(id);
    return {
      provider_id: id,
      deleted: true,
      deleted_claims: Number(claimDelete.changes),
      deleted_referrals: Number(referralDelete.changes),
    };
  });
  res.status(200).json(result);
});

app.get("/api/claims", (req, res) => {
  const filters = getRows(req);
  let rows = readClaims(db);
  if (req.query.provider_id) rows = rows.filter((row: any) => row.provider_id === String(req.query.provider_id));
  if (req.query.specialty) rows = rows.filter((row: any) => row.specialty === String(req.query.specialty));
  if (req.query.date_from) rows = rows.filter((row: any) => row.claim_date >= String(req.query.date_from));
  if (req.query.date_to) rows = rows.filter((row: any) => row.claim_date <= String(req.query.date_to));
  if (filters.q) rows = rows.filter((row: any) => [row.claim_id, row.provider_id, row.patient_id, row.procedure_code, row.specialty, row.referred_to].some((v) => String(v || "").toLowerCase().includes(filters.q)));
  sortRows(rows, String(req.query.sort || "claim_date"), String(req.query.direction || "desc"));
  res.json(paged(rows, req));
});
app.post("/api/claims", (req, res) => {
  const body = req.body || {};
  const id = text(body.claim_id, "claim_id", 2, 40)!;
  const providerId = validateProviderId(body.provider_id);
  const provider = assertProviderExists(providerId);
  const patientId = text(body.patient_id, "patient_id", 1, 80)!;
  if (!/^(PAT|SYN|DEMO)[A-Za-z0-9_-]*$/i.test(patientId)) throw new HttpError(400, "patient_id must use a synthetic identifier prefix (PAT, SYN, or DEMO). No real patient identifiers should be entered.");
  const procedureCode = text(body.procedure_code, "procedure_code", 1, 80)!;
  const amount = validateAmount(body.claim_amount);
  const date = validateDate(body.claim_date, "claim_date")!;
  const specialty = body.specialty === undefined ? provider.specialty : validateSpecialty(body.specialty);
  const referredTo = body.referred_to ? validateProviderId(body.referred_to, "referred_to") : null;
  if (referredTo) assertProviderExists(referredTo);
  const rawTargets = body.referral_targets === undefined || body.referral_targets === null ? [] : body.referral_targets;
  if (!Array.isArray(rawTargets)) throw new HttpError(400, "referral_targets must be an array of provider IDs.");
  if (rawTargets.length > 100) throw new HttpError(400, "A claim can create at most 100 referral events in one operation.");
  const referralTargets = rawTargets.map((value: unknown) => validateProviderId(value, "referral_targets[]"));
  if (new Set(referralTargets).size !== referralTargets.length) throw new HttpError(400, "referral_targets cannot contain duplicate provider IDs.");
  if (referralTargets.includes(providerId)) throw new HttpError(400, "A provider cannot be selected as its own referral recipient.");
  if (referralTargets.length && referredTo) throw new HttpError(400, "Use referral_targets to create network events; do not combine it with the legacy referred_to claim field.");
  for (const targetId of referralTargets) {
    const target = assertProviderExists(targetId);
    if (target.status === "INACTIVE") throw new HttpError(400, `Referral recipient '${targetId}' is inactive. Reactivate it before creating new referral events.`);
  }
  const time = now();
  const created = finishInputMutation("claim", id, referralTargets.length ? "CREATE_WITH_REFERRALS" : "CREATE", undefined, () => {
    db.prepare("INSERT INTO claims(claim_id,provider_id,patient_id,procedure_code,claim_amount,claim_date,specialty,referred_to,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(id, providerId, patientId, procedureCode, amount, date, specialty, referredTo, time, time);
    const referralRows: any[] = [];
    const insertReferral = db.prepare("INSERT INTO referrals(referral_id,from_provider,to_provider,reason,event_date,source_claim_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)");
    for (const targetId of referralTargets) {
      const referral = {
        referral_id: newId("REF"), from_provider: providerId, to_provider: targetId,
        reason: "claim_linked_referral", event_date: date, source_claim_id: id,
        created_at: time, updated_at: time,
      };
      insertReferral.run(referral.referral_id, referral.from_provider, referral.to_provider, referral.reason,
        referral.event_date, referral.source_claim_id, referral.created_at, referral.updated_at);
      recordAudit({ entityType: "referral", entityId: referral.referral_id, operation: "CREATE_FROM_CLAIM", before: undefined, after: referral }, db);
      referralRows.push(referral);
    }
    return { claim: publicClaim(getClaimRaw(id)), created_referrals: referralRows };
  });
  res.status(201).json({ ...created.claim, created_referrals: created.created_referrals });
});
app.patch("/api/claims/:claimId", (req, res) => {
  const id = req.params.claimId;
  const before = getClaimRaw(id);
  const body = req.body || {};
  // `referral_targets` is a set-like representation of the claim's linked referral
  // recipients. If omitted by an older API client, leave those events untouched.
  // If supplied (including an empty array), reconcile the linked events to that set.
  const managesReferralTargets = Object.prototype.hasOwnProperty.call(body, "referral_targets");
  const providerId = body.provider_id === undefined ? before.provider_id : validateProviderId(body.provider_id);
  const provider = assertProviderExists(providerId);
  const patientId = body.patient_id === undefined ? before.patient_id : text(body.patient_id, "patient_id", 1, 80)!;
  if (!/^(PAT|SYN|DEMO)[A-Za-z0-9_-]*$/i.test(patientId)) throw new HttpError(400, "patient_id must use a synthetic identifier prefix (PAT, SYN, or DEMO).");
  const procedureCode = body.procedure_code === undefined ? before.procedure_code : text(body.procedure_code, "procedure_code", 1, 80)!;
  const amount = body.claim_amount === undefined ? Number(before.claim_amount) : validateAmount(body.claim_amount);
  const date = body.claim_date === undefined ? before.claim_date : validateDate(body.claim_date, "claim_date")!;
  const specialty = body.specialty === undefined ? before.specialty || provider.specialty : validateSpecialty(body.specialty);
  const referredTo = body.referred_to === undefined ? before.referred_to : (body.referred_to ? validateProviderId(body.referred_to, "referred_to") : null);
  if (referredTo) assertProviderExists(referredTo);
  let referralTargets: string[] = [];
  const existingLinked = db.prepare("SELECT * FROM referrals WHERE source_claim_id=? ORDER BY referral_id").all(id) as any[];
  const previouslyLinkedTargets = new Set(existingLinked.map((row) => String(row.to_provider)));
  if (managesReferralTargets) {
    const rawTargets = body.referral_targets === undefined || body.referral_targets === null ? [] : body.referral_targets;
    if (!Array.isArray(rawTargets)) throw new HttpError(400, "referral_targets must be an array of provider IDs.");
    if (rawTargets.length > 100) throw new HttpError(400, "A claim can have at most 100 linked referral recipients.");
    referralTargets = rawTargets.map((value: unknown) => validateProviderId(value, "referral_targets[]"));
    if (new Set(referralTargets).size !== referralTargets.length) throw new HttpError(400, "referral_targets cannot contain duplicate provider IDs.");
    if (referralTargets.includes(providerId)) throw new HttpError(400, "A provider cannot be selected as its own referral recipient.");
    for (const targetId of referralTargets) {
      const target = assertProviderExists(targetId);
      // Existing inactive recipients may be retained or removed. New relationships
      // to inactive providers are rejected, consistent with claim creation.
      if (target.status === "INACTIVE" && !previouslyLinkedTargets.has(targetId)) {
        throw new HttpError(400, `Referral recipient '${targetId}' is inactive. Reactivate it before adding a new linked referral event.`);
      }
    }
  }

  const result = finishInputMutation("claim", id, managesReferralTargets ? "UPDATE_WITH_REFERRAL_RECONCILIATION" : "UPDATE", publicClaim(before), () => {
    db.prepare("UPDATE claims SET provider_id=?,patient_id=?,procedure_code=?,claim_amount=?,claim_date=?,specialty=?,referred_to=?,updated_at=? WHERE claim_id=?").run(providerId, patientId, procedureCode, amount, date, specialty, referredTo, now(), id);
    const createdReferrals: any[] = [];
    const removedReferralIds: string[] = [];
    const updatedReferrals: any[] = [];

    if (managesReferralTargets) {
      const desired = new Set(referralTargets);
      const linked = db.prepare("SELECT * FROM referrals WHERE source_claim_id=? ORDER BY referral_id").all(id) as any[];
      const retainedRecipients = new Set<string>();

      for (const referral of linked) {
        if (!desired.has(String(referral.to_provider))) {
          db.prepare("DELETE FROM referrals WHERE referral_id=?").run(referral.referral_id);
          recordAudit({
            entityType: "referral", entityId: referral.referral_id, operation: "REMOVE_FROM_CLAIM",
            before: referral,
            after: { deleted: true, reason: "recipient_removed_during_claim_edit", source_claim_id: id },
          }, db);
          removedReferralIds.push(String(referral.referral_id));
          continue;
        }

        retainedRecipients.add(String(referral.to_provider));
        // A retained linked event follows the claim's source provider and claim date.
        // Standalone/manual referral events have source_claim_id NULL and are untouched.
        if (referral.from_provider !== providerId || referral.event_date !== date) {
          const after = { ...referral, from_provider: providerId, event_date: date, updated_at: now() };
          db.prepare("UPDATE referrals SET from_provider=?,event_date=?,updated_at=? WHERE referral_id=?")
            .run(providerId, date, after.updated_at, referral.referral_id);
          recordAudit({ entityType: "referral", entityId: referral.referral_id, operation: "UPDATE_FROM_CLAIM_EDIT", before: referral, after }, db);
          updatedReferrals.push(after);
        }
      }

      const insertReferral = db.prepare("INSERT INTO referrals(referral_id,from_provider,to_provider,reason,event_date,source_claim_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)");
      const time = now();
      for (const targetId of referralTargets) {
        if (retainedRecipients.has(targetId)) continue;
        const referral = {
          referral_id: newId("REF"), from_provider: providerId, to_provider: targetId,
          reason: "claim_linked_referral", event_date: date, source_claim_id: id,
          created_at: time, updated_at: time,
        };
        insertReferral.run(referral.referral_id, referral.from_provider, referral.to_provider, referral.reason,
          referral.event_date, referral.source_claim_id, referral.created_at, referral.updated_at);
        recordAudit({ entityType: "referral", entityId: referral.referral_id, operation: "CREATE_FROM_CLAIM_EDIT", before: undefined, after: referral }, db);
        createdReferrals.push(referral);
      }
    }

    const claim = publicClaim(getClaimRaw(id));
    const linkedReferrals = managesReferralTargets
      ? db.prepare("SELECT * FROM referrals WHERE source_claim_id=? ORDER BY referral_id").all(id)
      : undefined;
    return {
      ...claim,
      ...(managesReferralTargets ? {
        created_referrals: createdReferrals,
        removed_referral_ids: removedReferralIds,
        updated_referrals: updatedReferrals,
        linked_referrals: linkedReferrals,
      } : {}),
    };
  });
  // Maintain the claim's usual top-level response fields for existing clients while
  // exposing referral changes to clients that want an explicit confirmation.
  res.json(result);
});
app.delete("/api/claims/:claimId", (req, res) => {
  const id = req.params.claimId;
  const before = getClaimRaw(id);
  finishInputMutation("claim", id, "DELETE", publicClaim(before), () => { db.prepare("DELETE FROM claims WHERE claim_id=?").run(id); return { claim_id: id, deleted: true }; });
  res.json({ claim_id: id, deleted: true });
});

app.get("/api/referrals", (req, res) => {
  const filters = getRows(req);
  let rows = readReferrals(db);
  if (req.query.provider_id) rows = rows.filter((row: any) => row.from_provider === String(req.query.provider_id) || row.to_provider === String(req.query.provider_id));
  if (filters.q) rows = rows.filter((row: any) => [row.referral_id, row.from_provider, row.to_provider, row.reason, row.source_claim_id].some((v) => String(v || "").toLowerCase().includes(filters.q)));
  sortRows(rows, String(req.query.sort || "referral_id"), String(req.query.direction || "asc"));
  res.json(paged(rows, req));
});
app.post("/api/referrals", (req, res) => {
  const body = req.body || {};
  const id = text(body.referral_id, "referral_id", 2, 40)!;
  const from = validateProviderId(body.from_provider, "from_provider");
  const to = validateProviderId(body.to_provider, "to_provider");
  assertProviderExists(from); assertProviderExists(to);
  const reason = text(body.reason || "unspecified", "reason", 1, 160)!;
  const eventDate = validateDate(body.event_date, "event_date", true);
  const time = now();
  const created = finishInputMutation("referral", id, "CREATE", undefined, () => {
    db.prepare("INSERT INTO referrals(referral_id,from_provider,to_provider,reason,event_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(id, from, to, reason, eventDate, time, time);
    return getReferralRaw(id);
  });
  res.status(201).json(created);
});
app.patch("/api/referrals/:referralId", (req, res) => {
  const id = req.params.referralId;
  const before = getReferralRaw(id);
  const body = req.body || {};
  const from = body.from_provider === undefined ? before.from_provider : validateProviderId(body.from_provider, "from_provider");
  const to = body.to_provider === undefined ? before.to_provider : validateProviderId(body.to_provider, "to_provider");
  assertProviderExists(from); assertProviderExists(to);
  const reason = body.reason === undefined ? before.reason : text(body.reason, "reason", 1, 160)!;
  const eventDate = body.event_date === undefined ? before.event_date : validateDate(body.event_date, "event_date", true);
  const updated = finishInputMutation("referral", id, "UPDATE", before, () => {
    db.prepare("UPDATE referrals SET from_provider=?,to_provider=?,reason=?,event_date=?,updated_at=? WHERE referral_id=?").run(from, to, reason, eventDate, now(), id);
    return getReferralRaw(id);
  });
  res.json(updated);
});
app.delete("/api/referrals/:referralId", (req, res) => {
  const id = req.params.referralId;
  const before = getReferralRaw(id);
  finishInputMutation("referral", id, "DELETE", before, () => { db.prepare("DELETE FROM referrals WHERE referral_id=?").run(id); return { referral_id: id, deleted: true }; });
  res.json({ referral_id: id, deleted: true });
});

app.get("/api/fraud/rings", (_req, res) => {
  if (!analyticsState.analytics) return res.status(503).json({ error: "Live graph analytics are unavailable.", detail: analyticsState.error });
  res.json(analyticsState.analytics.rings);
});
app.get("/api/graph", (_req, res) => {
  if (!analyticsState.analytics) return res.status(503).json({ error: "Live graph analytics are unavailable.", detail: analyticsState.error });
  res.json(analyticsState.analytics.graph);
});

app.get("/api/investigations", (req, res) => {
  let rows = readInvestigations(db).map((item: any) => ({ ...item, notes: readNotes(item.case_id, db) }));
  const q = String(req.query.q || "").trim().toLowerCase();
  const status = String(req.query.status || "").toUpperCase();
  if (status) rows = rows.filter((item: any) => item.status === status);
  if (req.query.provider_id) rows = rows.filter((item: any) => item.provider_id === String(req.query.provider_id));
  if (q) rows = rows.filter((item: any) => [item.case_id, item.provider_id, item.provider_name, item.title, item.status].some((value) => String(value || "").toLowerCase().includes(q)));
  res.json(rows);
});
app.get("/api/investigations/:caseId", (req, res) => {
  const item = getCaseRaw(req.params.caseId);
  res.json({ ...item, provider_name: getProviderRaw(item.provider_id).provider_name, notes: readNotes(item.case_id, db), audit: readAudit(100, "investigation", item.case_id, db) });
});
app.post("/api/investigations", (req, res) => {
  const providerId = validateProviderId(req.body?.provider_id);
  assertProviderExists(providerId);
  const title = text(req.body?.title, "title", 1, 180)!;
  const status = String(req.body?.status || "PENDING REVIEW").toUpperCase();
  if (!CASE_STATUSES.includes(status)) throw new HttpError(400, `status must be one of: ${CASE_STATUSES.join(", ")}.`);
  const caseId = newId("CASE");
  const created = finishCaseMutation("investigation", caseId, "CREATE", undefined, () => {
    db.prepare("INSERT INTO investigations(case_id,provider_id,title,status,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(caseId, providerId, title, status, now(), now());
    return { ...getCaseRaw(caseId), provider_name: getProviderRaw(providerId).provider_name, notes: [] };
  });
  res.status(201).json(created);
});
app.patch("/api/investigations/:caseId", (req, res) => {
  const id = req.params.caseId;
  const before = getCaseRaw(id);
  const title = req.body?.title === undefined ? before.title : text(req.body.title, "title", 1, 180)!;
  const status = req.body?.status === undefined ? before.status : String(req.body.status).toUpperCase();
  if (!CASE_STATUSES.includes(status)) throw new HttpError(400, `status must be one of: ${CASE_STATUSES.join(", ")}.`);
  const updated = finishCaseMutation("investigation", id, "UPDATE", before, () => {
    db.prepare("UPDATE investigations SET title=?,status=?,updated_at=? WHERE case_id=?").run(title, status, now(), id);
    return { ...getCaseRaw(id), provider_name: getProviderRaw(before.provider_id).provider_name, notes: readNotes(id, db) };
  });
  res.json(updated);
});
app.delete("/api/investigations/:caseId", (req, res) => {
  const id = req.params.caseId;
  const before = getCaseRaw(id);
  const count = Number((db.prepare("SELECT COUNT(*) AS n FROM investigation_notes WHERE case_id=?").get(id) as any).n);
  if (count > 0) throw new HttpError(409, "This case has investigator notes and cannot be deleted; mark it Resolved or Dismissed to preserve its history.");
  finishCaseMutation("investigation", id, "DELETE", before, () => { db.prepare("DELETE FROM investigations WHERE case_id=?").run(id); return { case_id: id, deleted: true }; });
  res.json({ case_id: id, deleted: true });
});
app.post("/api/investigations/:caseId/notes", (req, res) => {
  const caseId = req.params.caseId;
  getCaseRaw(caseId);
  const body = text(req.body?.body, "note body", 1, 5000)!;
  const createdBy = text(req.body?.created_by || "Local investigator", "created_by", 1, 100)!;
  const noteId = newId("NOTE");
  const note = finishCaseMutation("investigation_note", noteId, "CREATE", undefined, () => {
    db.prepare("INSERT INTO investigation_notes(note_id,case_id,body,created_by,created_at) VALUES(?,?,?,?,?)").run(noteId, caseId, body, createdBy, now());
    db.prepare("UPDATE investigations SET updated_at=? WHERE case_id=?").run(now(), caseId);
    return { note_id: noteId, case_id: caseId, body, created_by: createdBy, created_at: now() };
  });
  res.status(201).json(note);
});
app.get("/api/audit", (req, res) => {
  const limit = Math.min(500, Math.max(1, Number.parseInt(String(req.query.limit || "100"), 10) || 100));
  res.json(readAudit(limit, req.query.entity_type ? String(req.query.entity_type) : undefined, req.query.entity_id ? String(req.query.entity_id) : undefined, db));
});

function csvCell(value: unknown): string {
  let str = value === null || value === undefined ? "" : String(value);
  // Apply formula-injection protection to untrusted text, not numeric values such as negative Z-scores.
  if (typeof value === "string" && /^[\u0000-\u0020]*[=+@\-]/.test(str)) str = `'${str}`;
  return `"${str.replace(/"/g, '""')}"`;
}
function sendCsv(res: Response, filename: string, headers: string[], rows: any[][]) {
  const content = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(`\uFEFF${content}`);
}
app.get("/api/export/providers.csv", (_req, res) => {
  const rows = readProviders(db).map((provider: any) => ({ ...provider, ...(analyticsState.analytics?.providers || []).find((row: any) => row.provider_id === provider.provider_id) }));
  sendCsv(res, "healthcare-fraud-providers.csv", ["provider_id", "provider_name", "specialty", "city", "status", "claim_count", "total_billed_amount", "specialty_z_score", "risk_score", "risk_level", "pagerank", "scc_id", "ring_detected"], rows.map((x: any) => [x.provider_id, x.provider_name, x.specialty, x.city, x.status, x.claim_count, x.total_billed_amount, x.specialty_z_score, x.risk_score, x.risk_level, x.pagerank, x.scc_id, x.ring_detected]));
});
app.get("/api/export/claims.csv", (_req, res) => sendCsv(res, "healthcare-claims.csv", ["claim_id", "provider_id", "patient_id", "procedure_code", "claim_amount_billed", "claim_date", "specialty", "referred_to"], readClaims(db).map((x: any) => [x.claim_id, x.provider_id, x.patient_id, x.procedure_code, x.claim_amount, x.claim_date, x.specialty, x.referred_to])));
app.get("/api/export/referrals.csv", (_req, res) => sendCsv(res, "healthcare-referral-events.csv", ["referral_id", "from_provider", "to_provider", "reason", "event_date", "source_claim_id"], readReferrals(db).map((x: any) => [x.referral_id, x.from_provider, x.to_provider, x.reason, x.event_date, x.source_claim_id])));
app.get("/api/export/investigations.csv", (_req, res) => sendCsv(res, "healthcare-investigations.csv", ["case_id", "provider_id", "provider_name", "title", "status", "created_at", "updated_at", "note_count"], readInvestigations(db).map((x: any) => [x.case_id, x.provider_id, x.provider_name, x.title, x.status, x.created_at, x.updated_at, readNotes(x.case_id, db).length])));
function htmlEscape(value: unknown): string {
  return String(value ?? "—").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
app.get("/api/reports/provider/:pid/print", (req, res) => {
  const p = { ...getProviderRaw(req.params.pid), ...providerAnalytics(req.params.pid) };
  const generatedAt = now();
  const claims = db.prepare("SELECT claim_id,claim_date,procedure_code,claim_amount,specialty FROM claims WHERE provider_id=? ORDER BY claim_date DESC").all(req.params.pid) as any[];
  const referrals = db.prepare("SELECT referral_id,from_provider,to_provider,reason,event_date,source_claim_id FROM referrals WHERE from_provider=? OR to_provider=? ORDER BY referral_id").all(req.params.pid, req.params.pid) as any[];
  const cases = readInvestigations(db).filter((item: any) => item.provider_id === req.params.pid).map((item: any) => ({ ...item, notes: readNotes(item.case_id, db) }));
  const list = (items: string[]) => items.length ? `<ul>${items.map((item) => `<li>${htmlEscape(item)}</li>`).join("")}</ul>` : `<p class="muted">No records.</p>`;
  const componentWeightLabel = (key: string, nominal: number) => `${nominal}% nominal / ${p.effective_component_weights?.[key] == null ? "not used" : `${(Number(p.effective_component_weights[key]) * 100).toFixed(1)}% effective`}`;
  const claimsHtml = claims.length ? `<table><thead><tr><th>Claim ID</th><th>Date</th><th>Procedure</th><th>Amount billed</th><th>Claim specialty</th></tr></thead><tbody>${claims.map((claim) => `<tr><td>${htmlEscape(claim.claim_id)}</td><td>${htmlEscape(claim.claim_date)}</td><td>${htmlEscape(claim.procedure_code)}</td><td>${htmlEscape(Number(claim.claim_amount).toLocaleString("en-IN", { style: "currency", currency: "INR" }))}</td><td>${htmlEscape(claim.specialty)}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">No claim records for this provider.</p>`;
  const referralsHtml = referrals.length ? `<table><thead><tr><th>Referral ID</th><th>Source</th><th>Destination</th><th>Reason</th><th>Date</th><th>Source claim</th></tr></thead><tbody>${referrals.map((ref) => `<tr><td>${htmlEscape(ref.referral_id)}</td><td>${htmlEscape(ref.from_provider)}</td><td>${htmlEscape(ref.to_provider)}</td><td>${htmlEscape(ref.reason)}</td><td>${htmlEscape(ref.event_date || "Not recorded")}</td><td>${htmlEscape(ref.source_claim_id || "Standalone event")}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">No referral records for this provider.</p>`;
  const casesHtml = cases.length ? cases.map((item: any) => `<article class="case"><h3>${htmlEscape(item.title)}</h3><p><strong>${htmlEscape(item.case_id)}</strong> · ${htmlEscape(item.status)} · Updated ${htmlEscape(item.updated_at)}</p>${list((item.notes || []).map((note: any) => `${note.created_by} (${note.created_at}): ${note.body}`))}</article>`).join("") : `<p class="muted">No investigation history.</p>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Provider investigation report — ${htmlEscape(p.provider_id)}</title><style>
    :root{font-family:Arial,Helvetica,sans-serif;color:#172033;background:#fff}body{max-width:1100px;margin:32px auto;padding:0 24px;font-size:12px;line-height:1.6}header{border-bottom:2px solid #263b60;padding-bottom:16px;margin-bottom:20px}h1{font-size:25px;margin:4px 0}h2{font-size:16px;margin:25px 0 8px;border-bottom:1px solid #d8e0ed;padding-bottom:6px}h3{font-size:13px;margin-bottom:3px}.muted{color:#637189}.meta{display:flex;gap:20px;flex-wrap:wrap;color:#586780}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.metric{border:1px solid #cfd7e5;border-radius:7px;padding:10px}.metric small{display:block;color:#637189}.metric b{font-size:18px}table{width:100%;border-collapse:collapse;margin:9px 0 18px}th,td{border-bottom:1px solid #dbe2ec;padding:7px;text-align:left}th{background:#f2f5f9;font-size:10px;text-transform:uppercase}.note{background:#f7f9fc;border-left:3px solid #718ec4;padding:10px;margin:8px 0}.actions{display:flex;justify-content:flex-end;margin-bottom:15px}button{border:0;border-radius:5px;padding:9px 14px;background:#243e67;color:white;font-weight:bold;cursor:pointer}.disclaimer{margin-top:22px;padding:11px;border:1px solid #e2c78f;background:#fff8e8}.case{break-inside:avoid;margin-bottom:12px}@media print{body{margin:0 auto;padding:0 12px}.actions{display:none}h2{break-after:avoid}table,article{break-inside:avoid}}
    </style></head><body><div class="actions"><button onclick="window.print()">Print / Save as PDF</button></div><header><div class="muted">HEALTHGUARD · HEALTHCARE FRAUD INTELLIGENCE</div><h1>Provider Investigation Report</h1><div class="meta"><span>Generated: ${htmlEscape(generatedAt)}</span><span>Model: ${htmlEscape(MODEL_VERSION)}</span><span>Data version: ${htmlEscape(getDataVersion(db))}</span><span>Synthetic demonstration data</span></div></header>
    <section><h2>Provider profile</h2><div class="metrics"><div class="metric"><small>Provider</small><b>${htmlEscape(p.provider_id)}</b><div>${htmlEscape(p.provider_name)}</div></div><div class="metric"><small>Risk score</small><b>${htmlEscape(p.risk_score === null ? "Insufficient data" : Number(p.risk_score).toFixed(2))}</b><div>${htmlEscape(p.risk_level)}</div></div><div class="metric"><small>Claims / total billed</small><b>${htmlEscape(p.claim_count)}</b><div>${htmlEscape(Number(p.total_billed_amount || 0).toLocaleString("en-IN", { style: "currency", currency: "INR" }))}</div></div><div class="metric"><small>Specialty · city</small><b>${htmlEscape(p.specialty)}</b><div>${htmlEscape(p.city)} · ${htmlEscape(p.status)}</div></div></div></section>
    <section><h2>Risk factors and explanation</h2><table><thead><tr><th>Component</th><th>Score</th><th>Nominal / effective weight</th></tr></thead><tbody><tr><td>Billing amount anomaly</td><td>${htmlEscape(p.statistical_risk ?? "Not evaluable")}</td><td>${htmlEscape(componentWeightLabel("statistical", 40))}</td></tr><tr><td>Referral-ring heuristic</td><td>${htmlEscape(p.referral_ring_risk ?? "Not applicable")}</td><td>${htmlEscape(componentWeightLabel("referral_ring", 30))}</td></tr><tr><td>Network heuristic</td><td>${htmlEscape(p.network_risk ?? "Not applicable")}</td><td>${htmlEscape(componentWeightLabel("network", 20))}</td></tr><tr><td>Comparative behavior</td><td>${htmlEscape(p.behaviour_risk ?? "Not evaluable")}</td><td>${htmlEscape(componentWeightLabel("behavior", 10))}</td></tr></tbody></table>${list(p.explanation || [])}<p class="muted">Mean billed amount (claims matching current specialty): ${htmlEscape(p.average_claim_amount ?? "—")} across ${htmlEscape(p.specialty_claim_count ?? 0)} claim(s) · Overall average across all claims: ${htmlEscape(p.overall_average_claim_amount ?? "—")} · Same-specialty peer median of provider means: ${htmlEscape(p.peer_median_average_claim_amount ?? "—")} · amount ratio: ${htmlEscape(p.average_claim_amount_ratio ?? "Not available")} · diagnostic Z-score: ${htmlEscape(p.specialty_z_score ?? "Not available")} · Peer providers: ${htmlEscape(p.peer_provider_count ?? 0)} · Z-score: ${htmlEscape(p.specialty_z_score ?? "Not available")}</p></section>
    <section><h2>Claims (${claims.length})</h2>${claimsHtml}</section><section><h2>Referral events (${referrals.length})</h2>${referralsHtml}</section><section><h2>Investigation history (${cases.length})</h2>${casesHtml}</section>
    <div class="disclaimer"><strong>Interpretation and limitations.</strong> This report uses synthetic demonstration records and heuristic indicators. A risk score, SCC, statistical outlier or network metric does not establish fraud. Verify underlying source records and apply independent human review. Claim amounts are labelled as billed amounts, not insurer-paid amounts.</div></body></html>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(html);
});

app.get("/api/reports/provider/:pid", (req, res) => {
  const p = { ...getProviderRaw(req.params.pid), ...providerAnalytics(req.params.pid) };
  const snapshot = { generated_at: now(), model_version: MODEL_VERSION, data_version: getDataVersion(db), synthetic_data: true, provider: p,
    claims: db.prepare("SELECT claim_id,claim_date,procedure_code,claim_amount,specialty,referred_to FROM claims WHERE provider_id=? ORDER BY claim_date DESC").all(req.params.pid),
    referrals: db.prepare("SELECT referral_id,from_provider,to_provider,reason,event_date,source_claim_id FROM referrals WHERE from_provider=? OR to_provider=? ORDER BY referral_id").all(req.params.pid, req.params.pid),
    investigations: readInvestigations(db).filter((item: any) => item.provider_id === req.params.pid).map((item: any) => ({ ...item, notes: readNotes(item.case_id, db) })) };
  res.json(snapshot);
});

app.use("/api", (_req, res) => res.status(404).json({ error: "API endpoint not found." }));
app.use(express.static(frontendDir, {
  etag: true,
  maxAge: "1h",
  setHeaders(res, filePath) {
    // The HTML shell must revalidate so cache-busted frontend asset versions take effect immediately.
    if (path.basename(filePath).toLowerCase() === "index.html") {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
  },
}));
app.get("*", (_req, res) => {
  const indexPath = path.join(frontendDir, "index.html");
  if (fs.existsSync(indexPath)) {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    return res.sendFile(indexPath);
  }
  return res.status(404).send("Frontend files are missing. Restore the frontend directory and restart the app.");
});

// Keep API failures structured; SQL constraints do not leak stack traces to the browser.
app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) return;
  const sqlMessage = String(error?.message || error);
  const status = error instanceof HttpError ? error.status
    : /UNIQUE constraint failed/.test(sqlMessage) || /FOREIGN KEY constraint failed/.test(sqlMessage) ? 409
      : /CHECK constraint failed|NOT NULL constraint failed/.test(sqlMessage) ? 400 : 500;
  const message = error instanceof HttpError ? error.message : /UNIQUE constraint failed/.test(sqlMessage)
    ? "A record with this identifier already exists. Choose a unique ID."
    : /FOREIGN KEY constraint failed/.test(sqlMessage)
      ? "The change references a missing or dependent record. Check provider and investigation relationships."
      : /CHECK constraint failed|NOT NULL constraint failed/.test(sqlMessage)
        ? "The data violates a database integrity rule. Check the submitted fields."
        : "The server could not complete the request.";
  if (status >= 500) console.error("Request failed:", error);
  res.status(status).json({ error: message, ...(status === 500 ? { detail: process.env.NODE_ENV === "development" ? String(error?.message || error) : undefined } : {}) });
});

export function startServer(port = Number(process.env.PORT || 3000), host = process.env.HOST || "127.0.0.1") {
  return app.listen(port, host, () => console.log(`Healthcare Fraud Intelligence running at http://localhost:${port}\nHost: ${host} | SQLite: ${getDatabasePath()} | Model: ${MODEL_VERSION} | Data version: ${getDataVersion(db)}`));
}
const invokedFile = process.argv[1] ? path.basename(process.argv[1]).toLowerCase() : "";
if (invokedFile === "server.ts") {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid TCP port between 1 and 65535.");
  startServer(port);
}

export default app;

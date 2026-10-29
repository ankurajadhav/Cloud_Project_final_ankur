import { calculateAnalytics } from "./analytics.ts";

/** Compatibility entry point for callers that explicitly supply the current persisted snapshot.
 * It intentionally has no embedded-data or demo-results fallback.
 */
export function runPipeline(input: { providers: any[]; claims: any[]; referrals: any[]; cases?: any[]; dataVersion?: number }) {
  if (!input || !Array.isArray(input.providers) || !Array.isArray(input.claims) || !Array.isArray(input.referrals)) {
    throw new Error("runPipeline requires provider, claim and referral records from the current data store.");
  }
  return calculateAnalytics(input);
}

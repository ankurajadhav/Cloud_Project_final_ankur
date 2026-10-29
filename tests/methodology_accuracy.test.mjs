import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
const stats = fs.readFileSync(path.join(root, 'src/statistics.ts'), 'utf8');
const scoring = fs.readFileSync(path.join(root, 'src/scoring.ts'), 'utf8');
const analytics = fs.readFileSync(path.join(root, 'src/analytics.ts'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.ts'), 'utf8');
const app = fs.readFileSync(path.join(root, 'frontend/app.js'), 'utf8');

test('methodology page documents amount, signed diagnostic, activity, network, ring, and composite formulas', () => {
  assert.match(html, /median\(peer-provider means\)/);
  assert.match(html, /100 × log₂\(ratio\) ÷ 4/);
  assert.match(html, /round to 2 decimals/);
  assert.match(html, /round to 2 decimals of \[Σ_available\(scoreᵢ × nominal_weightᵢ\)/);
  assert.match(html, /signed Z-score/i);
  assert.match(html, /peer ratio = provider matching-specialty claims in current 30d ÷ median peer matching-specialty claims in current 30d/);
  assert.match(html, /own trend ratio = provider matching-specialty claims in current 30d ÷ provider matching-specialty claims in prior 30d/);
  assert.match(html, /burst ratio = \(matching-specialty claims in last 7d ÷ 7\) ÷ \(matching-specialty claims in preceding 23d ÷ 23\)/);
  assert.match(html, /at least two of the three behavior signals must be evaluable/i);
  assert.match(stats, /BEHAVIOR_SIGNAL_WEIGHTS = \{ peer_30d: 0\.50, own_30d_trend: 0\.30, short_burst: 0\.20 \}/);
  assert.match(html, /0\.6 × \(PageRank/);
  assert.match(html, /0\.4 × \(incident events/);
  assert.match(html, /35 \+ 30D \+ min\(10, 2R\)/);
  assert.match(html, /Σ_available\(scoreᵢ × nominal_weightᵢ\)/);
});

test('zero peer baseline behavior in source matches methodology and model version', () => {
  assert.match(stats, /if \(baseline === 0\) return null/);
  assert.match(scoring, /MODEL_VERSION = "hfi-2\.3\.3"/);
  assert.match(analytics, /model_version: MODEL_VERSION/);
  assert.match(analytics, /median of distinct same-specialty provider means/);
  assert.match(analytics, /time-aware behavior/);
  assert.match(scoring, /Signed diagnostic Z-score is unavailable because the peer-provider means have zero sample standard deviation/);
  assert.doesNotMatch(analytics, /median of independent same-specialty provider means/);
  assert.match(html, /zero peer-median baseline is unevaluable, including the 0 ÷ 0 case/i);
});

test('methodology does not claim that peer providers are proven statistically independent', () => {
  assert.match(html, /distinct claim-bearing peer providers/);
  assert.match(html, /not guaranteed to be statistically independent/);
  assert.doesNotMatch(html, /three independent claim-bearing same-specialty peers/i);
});


test('history distinguishes data versions from model-only snapshots', () => {
  assert.match(server, /compare provider risk scores only when model_version matches/);
  assert.match(server, /historical_data_available: dataVersions.length > 1/);
  assert.match(app, /keep only the latest[\s\S]*?snapshot per data version/);
  assert.match(app, /const byDataVersion = new Map\(\)/);
  assert.match(html, /Stored data\/model snapshots; a model update can occur without a data change/);
});

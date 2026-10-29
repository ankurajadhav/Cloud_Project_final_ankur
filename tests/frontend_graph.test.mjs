import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(root, 'frontend/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'frontend/style.css'), 'utf8');
const graphStart = app.indexOf('  function renderGraph() {');
const graphEnd = app.indexOf('\n  function renderCases() {', graphStart);
assert.ok(graphStart >= 0 && graphEnd > graphStart, 'renderGraph function should exist');
const graph = app.slice(graphStart, graphEnd);

test('referral network uses the previous circular layout, not SCC tiles', () => {
  assert.match(graph, /const width = 1240, height = 660, cx = width \/ 2, cy = height \/ 2, radius = 260/);
  assert.match(graph, /nodes\.forEach\(\(node, index\) => \{/);
  assert.match(graph, /graph-orbit/);
  assert.match(graph, /const sourceRadius = source\.ring_detected \? 21 : 18\.5/);
  assert.doesNotMatch(graph, /tilePositions|component-layer|Clusters group SCC members|isSmallCycle|smallCycle/);
});

test('referral directions use high-contrast arrow markers and separate reciprocal links', () => {
  assert.match(graph, /arrow-normal-v2311/);
  assert.match(graph, /arrow-ring-v2311/);
  assert.match(graph, /'marker-end': `url\(#\$\{markerId\}\)`/);
  assert.match(graph, /const preferredBend = reverseExists \? 36 : \(\(edgeIndex % 7\) - 3\) \* 5/);
  assert.match(app, /function buildGraphEdgeRoute\(options\)/);
  assert.match(app, /const clearance = obstacle\.radius \+ 6/);
  assert.match(app, /node-clearance routing/);
  assert.match(graph, /hover a provider to highlight its links/);
  assert.match(graph, /markerWidth: 16, markerHeight: 16/);
  assert.doesNotMatch(graph, /arrow-normal-v239|arrow-ring-v239/);
});

test('network shows unique dependency semantics, repeated event counts, and live snapshot freshness', () => {
  assert.match(graph, /unique directed dependencies/);
  assert.match(graph, /eventCount > 1/);
  assert.match(graph, /Data v\$\{dataVersion\}/);
  assert.match(html, /style\.css\?v=2\.3\.13/);
  assert.match(html, /app\.js\?v=2\.3\.13/);
  assert.match(css, /time-aware behavior risk signals/);
  assert.match(app, /Verified directed cycle/);
  assert.match(app, /unique links · \$\{totalEvents\} referral events/);
  assert.match(app, /ring-edge-item/);
  assert.match(app, /const totalEvents = edges\.reduce/);
  assert.match(app, /ring-path-caption/);
  assert.match(graph, /const labelX = midX \+ radialX \/ radialLength \* 21/);
  assert.match(graph, /const width = 1240, height = 660/);
  assert.doesNotMatch(graph, /tilePositions|component-layer|Clusters group SCC members|layout = 'scc'/);
});


test('edge routing chooses curves that clear unrelated provider nodes', () => {
  const routeStart = app.indexOf('function buildGraphEdgeRoute(');
  const routeEnd = app.indexOf('\n  function renderGraph()', routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart, 'pure edge-routing helper should exist before renderGraph');
  const routeFunction = vm.runInNewContext(`(${app.slice(routeStart, routeEnd).trim()})`);
  const providers = JSON.parse(fs.readFileSync(path.join(root, 'data/providers.json'), 'utf8'))
    .sort((a, b) => String(a.provider_id).localeCompare(String(b.provider_id), undefined, { numeric: true, sensitivity: 'base' }));
  const referralEvents = JSON.parse(fs.readFileSync(path.join(root, 'data/referrals.json'), 'utf8'));
  const eventCounts = new Map();
  for (const event of referralEvents) {
    const key = `${event.from_provider}\u0000${event.to_provider}`;
    eventCounts.set(key, (eventCounts.get(key) || 0) + 1);
  }
  const edges = [...eventCounts.entries()].map(([key, event_count]) => {
    const [from_provider, to_provider] = key.split('\u0000');
    return { from_provider, to_provider, event_count };
  }).sort((a, b) => String(a.from_provider).localeCompare(String(b.from_provider), undefined, { numeric: true }) ||
    String(a.to_provider).localeCompare(String(b.to_provider), undefined, { numeric: true }));
  // These are the two reportable cyclic components in the supplied synthetic seed graph.
  const ringProviders = new Set(['P001', 'P002', 'P003', 'P007', 'P008', 'P009', 'P010']);
  const width = 1240, height = 660, cx = width / 2, cy = height / 2, radius = 260;
  const positions = new Map(providers.map((node, index) => {
    const angle = -Math.PI / 2 + index / providers.length * Math.PI * 2;
    return [node.provider_id, { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) }];
  }));
  const obstacles = providers.map((node) => ({
    provider_id: node.provider_id,
    ...positions.get(node.provider_id),
    radius: ringProviders.has(node.provider_id) ? 20.5 : 18,
  }));
  const edgeKeys = new Set(edges.map((edge) => `${edge.from_provider}\u0000${edge.to_provider}`));
  const priorRoutes = [];
  const routed = [];
  for (let index = 0; index < edges.length; index++) {
    const edge = edges[index];
    if (edge.from_provider === edge.to_provider) continue;
    const a = positions.get(edge.from_provider), b = positions.get(edge.to_provider);
    const reverseExists = edgeKeys.has(`${edge.to_provider}\u0000${edge.from_provider}`);
    const preferredBend = reverseExists ? 36 : ((index % 7) - 3) * 5;
    const route = routeFunction({
      a, b, sourceId: edge.from_provider, targetId: edge.to_provider,
      sourceRadius: ringProviders.has(edge.from_provider) ? 21 : 18.5,
      targetRadius: ringProviders.has(edge.to_provider) ? 21 : 18.5,
      preferredBend, obstacles, priorRoutes, width, height,
    });
    assert.equal(route.collisionCount, 0, `${edge.from_provider} → ${edge.to_provider} should avoid all unrelated provider circles`);
    assert.ok(Math.abs(Math.hypot(route.x2 - b.x, route.y2 - b.y) - (ringProviders.has(edge.to_provider) ? 24 : 21.5)) < 0.01,
      `${edge.from_provider} → ${edge.to_provider} arrow endpoint should stop just outside its actual target node`);
    priorRoutes.push({ from: edge.from_provider, to: edge.to_provider, samples: route.samples });
    routed.push(route);
  }
  assert.equal(routed.length, 66, 'all unique seed dependencies should have a route');
  assert.ok(routed.some((route) => Math.abs(route.bend) > 40), 'a link should be able to take a detour when the direct lane is obstructed');
});

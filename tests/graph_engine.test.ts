import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEdgeWeights, buildGraph, findCyclePath, graphSignals, pagerank, tarjanScc } from '../src/graph_engine.ts';

const providers = (ids: string[]) => ids.map((provider_id) => ({ provider_id }));
const referral = (id: string, from_provider: string, to_provider: string) => ({ referral_id: id, from_provider, to_provider });

test('empty graph returns no ranks, SCCs, or edges', () => {
  assert.deepEqual(pagerank({}), {});
  assert.deepEqual(tarjanScc({}), []);
  const result = graphSignals({}, {}, []);
  assert.deepEqual(result.sccs, []);
  assert.equal(result.uniqueDirectedEdges, 0);
});

test('isolated nodes retain normalized PageRank and are not cyclic', () => {
  const graph = { A: [], B: [], C: [] };
  const ranks = pagerank(graph);
  assert.ok(Math.abs(Object.values(ranks).reduce((sum, v) => sum + v, 0) - 1) < 1e-9);
  assert.ok(Object.values(ranks).every((v) => Math.abs(v - 1 / 3) < 1e-8));
  const signals = graphSignals(graph);
  assert.equal(signals.sccs.filter((component) => component.ring_detected).length, 0);
});

test('a directed chain is not a cycle', () => {
  const graph = { A: ['B'], B: ['C'], C: [] };
  const result = graphSignals(graph);
  assert.equal(result.sccs.filter((component) => component.ring_detected).length, 0);
  assert.deepEqual(tarjanScc(graph).map((component) => component.length).sort(), [1, 1, 1]);
});

test('three-node directed cycle returns a valid path that exists in graph edges', () => {
  const events = [referral('R1', 'A', 'B'), referral('R2', 'B', 'C'), referral('R3', 'C', 'A')];
  const graph = buildGraph(providers(['A', 'B', 'C']), events);
  const result = graphSignals(graph, buildEdgeWeights(events), events);
  const ring = result.sccs.find((component) => component.ring_detected);
  assert.ok(ring);
  assert.equal(ring?.size, 3);
  assert.ok(ring?.cycle_path);
  assert.equal(ring?.cycle_path?.[0], ring?.cycle_path?.at(-1));
  const edges = new Set(Object.entries(graph).flatMap(([a, targets]) => targets.map((b) => `${a}->${b}`)));
  for (let i = 0; i < (ring?.cycle_path?.length || 0) - 1; i += 1) assert.ok(edges.has(`${ring!.cycle_path![i]}->${ring!.cycle_path![i + 1]}`));
});

test('repeated referral events are retained as weights but do not duplicate topology', () => {
  const events = [referral('R1', 'A', 'B'), referral('R2', 'A', 'B'), referral('R3', 'A', 'B'), referral('R4', 'B', 'C'), referral('R5', 'C', 'A')];
  const graph = buildGraph(providers(['A', 'B', 'C']), events);
  assert.deepEqual(graph.A, ['B']);
  const result = graphSignals(graph, buildEdgeWeights(events), events);
  assert.equal(result.uniqueDirectedEdges, 3);
  assert.equal(result.referralEvents, 5);
  assert.equal(result.edgeWeights.A.B, 3);
  assert.equal(result.signals.A.weighted_out_degree, 3);
  assert.equal(result.sccs.find((component) => component.ring_detected)?.repeated_event_count, 2);
  const ranks = Object.values(pagerank(graph, buildEdgeWeights(events)));
  assert.ok(Math.abs(ranks.reduce((sum, v) => sum + v, 0) - 1) < 1e-9);
});

test('two-provider cycle and singleton self-loop are cyclic but not reportable rings', () => {
  const two = graphSignals({ A: ['B'], B: ['A'] });
  assert.equal(two.sccs.some((component) => component.size === 2 && component.cyclic_component), true);
  assert.equal(two.sccs.some((component) => component.ring_detected), false);
  const self = graphSignals({ A: ['A'], B: [] });
  const singleton = self.sccs.find((component) => component.providers[0] === 'A');
  assert.equal(singleton?.cyclic_component, true);
  assert.equal(singleton?.ring_detected, false);
  assert.deepEqual(findCyclePath(['A'], { A: ['A'] }), ['A', 'A']);
});

test('removing a cycle edge removes ring membership; invalid dangling targets are ignored', () => {
  const cyclic = { A: ['B'], B: ['C'], C: ['A'] };
  assert.equal(graphSignals(cyclic).sccs.some((component) => component.ring_detected), true);
  const broken = { A: ['B'], B: ['C'], C: [] };
  assert.equal(graphSignals(broken).sccs.some((component) => component.ring_detected), false);
  const refs = [referral('R1', 'A', 'B'), referral('R2', 'B', 'MISSING')];
  assert.deepEqual(buildGraph(providers(['A', 'B']), refs), { A: ['B'], B: [] });
});

test('PageRank rejects an invalid damping factor', () => {
  assert.throws(() => pagerank({ A: [] }, {}, 1), /damping/);
});


test('neighbor count is a distinct union of incoming and outgoing providers and excludes self', () => {
  const graph = { A: ['A', 'B'], B: ['A'], C: [] };
  const signals = graphSignals(graph);
  assert.equal(signals.signals.A.in_degree, 2, 'self-loop contributes to directed in-degree');
  assert.equal(signals.signals.A.out_degree, 2, 'self-loop contributes to directed out-degree');
  assert.equal(signals.signals.A.neighbor_count, 1, 'only B is a distinct other provider');
  assert.equal(signals.signals.C.neighbor_count, 0);
});


test('PageRank validates its convergence controls', () => {
  assert.throws(() => pagerank({ A: [] }, {}, 0.85, 0), /maxIterations/);
  assert.throws(() => pagerank({ A: [] }, {}, 0.85, 10, Number.NaN), /tolerance/);
});


test('zero-weight outgoing edges behave as dangling transitions in weighted PageRank', () => {
  const ranks = pagerank({ A: ['B'], B: [] }, { A: { B: 0 } });
  assert.ok(Math.abs(ranks.A - 0.5) < 1e-8);
  assert.ok(Math.abs(ranks.B - 0.5) < 1e-8);
  assert.ok(Math.abs(Object.values(ranks).reduce((sum, value) => sum + value, 0) - 1) < 1e-9);
});


test('provider IDs matching JavaScript object properties do not corrupt referral weights', () => {
  const ids = ['constructor', 'toString', 'A'];
  const events = [referral('R1', 'constructor', 'toString'), referral('R2', 'toString', 'A'), referral('R3', 'A', 'constructor')];
  const graph = buildGraph(providers(ids), events);
  const weights = buildEdgeWeights(events);
  assert.equal(weights['constructor']['toString'], 1);
  assert.equal(weights['toString']['A'], 1);
  assert.equal(weights['A']['constructor'], 1);
  const result = graphSignals(graph, weights, events);
  assert.equal(result.sccs.some((component) => component.ring_detected && component.size === 3), true);
  assert.ok(Object.values(pagerank(graph, weights)).every(Number.isFinite));
});

/** Directed referral graph: unique neighbor links for topology, event counts as weights. */
export type Graph = Record<string, string[]>;
export type EdgeWeights = Record<string, Record<string, number>>;

export function buildGraph(providers: any[], referrals: any[]): Graph {
  const graph: Graph = Object.fromEntries(providers.map((provider) => [provider.provider_id, []]));
  for (const referral of referrals) {
    const source = referral.from_provider;
    const target = referral.to_provider;
    if (graph[source] && graph[target] && !graph[source].includes(target)) graph[source].push(target);
  }
  for (const node of Object.keys(graph)) graph[node].sort();
  return graph;
}

export function buildEdgeWeights(referrals: any[]): EdgeWeights {
  const weights: EdgeWeights = {};
  for (const referral of referrals) {
    const source = referral.from_provider;
    const target = referral.to_provider;
    // Provider IDs are user-editable. Check own properties so IDs such as
    // "constructor" and "toString" do not collide with Object.prototype.
    if (!Object.hasOwn(weights, source)) weights[source] = {};
    if (!Object.hasOwn(weights[source], target)) weights[source][target] = 0;
    weights[source][target] += 1;
  }
  return weights;
}

export function tarjanScc(graph: Graph): string[][] {
  let index = 0;
  const stack: string[] = [];
  // Map avoids collisions for valid provider IDs such as "constructor" and "toString".
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const components: string[][] = [];

  function visit(node: string): void {
    indices.set(node, index);
    low.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);
    for (const next of graph[node] || []) {
      if (!indices.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node)!, low.get(next)!));
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node)!, indices.get(next)!));
      }
    }
    if (low.get(node) === indices.get(node)) {
      const component: string[] = [];
      while (stack.length) {
        const member = stack.pop()!;
        onStack.delete(member);
        component.push(member);
        if (member === node) break;
      }
      component.sort();
      components.push(component);
    }
  }

  for (const node of Object.keys(graph).sort()) if (!indices.has(node)) visit(node);
  return components.sort((a, b) => b.length - a.length || a.join(",").localeCompare(b.join(",")));
}

/** PageRank with weighted edges, dangling-node redistribution, convergence tolerance and normalization. */
export function pagerank(graph: Graph, weights: EdgeWeights = {}, damping = 0.85, maxIterations = 200, tolerance = 1e-10): Record<string, number> {
  const nodes = Object.keys(graph).sort();
  const n = nodes.length;
  if (!n) return {};
  if (!(damping >= 0 && damping < 1)) throw new Error("PageRank damping must be in [0, 1).");
  if (!Number.isInteger(maxIterations) || maxIterations < 1) throw new Error("PageRank maxIterations must be a positive integer.");
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error("PageRank tolerance must be a finite non-negative number.");
  let rank: Record<string, number> = Object.fromEntries(nodes.map((node) => [node, 1 / n]));
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const hasPositiveWeightedOutgoing = (node: string) => (graph[node] || []).some((target) => Math.max(0, weights[node]?.[target] ?? 1) > 0);
    const danglingMass = nodes.reduce((sum, node) => sum + (!hasPositiveWeightedOutgoing(node) ? rank[node] : 0), 0);
    const next: Record<string, number> = Object.fromEntries(nodes.map((node) => [node, (1 - damping) / n + damping * danglingMass / n]));
    for (const source of nodes) {
      const targets = graph[source] || [];
      const totalWeight = targets.reduce((sum, target) => sum + Math.max(0, weights[source]?.[target] ?? 1), 0);
      if (totalWeight <= 0) continue;
      for (const target of targets) {
        const weight = Math.max(0, weights[source]?.[target] ?? 1);
        if (next[target] !== undefined) next[target] += damping * rank[source] * weight / totalWeight;
      }
    }
    const delta = nodes.reduce((sum, node) => sum + Math.abs(next[node] - rank[node]), 0);
    rank = next;
    if (delta < tolerance) break;
  }
  const total = Object.values(rank).reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(nodes.map((node) => [node, total > 0 ? rank[node] / total : 1 / n]));
}

/** Return a real directed cycle path within a component, including the repeated start at the end. */
export function findCyclePath(component: string[], graph: Graph): string[] | null {
  if (component.length === 1) {
    const node = component[0];
    return (graph[node] || []).includes(node) ? [node, node] : null;
  }
  const allowed = new Set(component);
  for (const start of [...component].sort()) {
    const path = [start];
    const inPath = new Set(path);
    function dfs(node: string): string[] | null {
      for (const next of (graph[node] || []).filter((target) => allowed.has(target)).sort()) {
        if (next === start && path.length > 1) return [...path, start];
        if (inPath.has(next)) continue;
        path.push(next);
        inPath.add(next);
        const result = dfs(next);
        if (result) return result;
        path.pop();
        inPath.delete(next);
      }
      return null;
    }
    const result = dfs(start);
    if (result) return result;
  }
  return null;
}

export function graphSignals(graph: Graph, weights: EdgeWeights = {}, referrals: any[] = []) {
  const components = tarjanScc(graph);
  const ranks = pagerank(graph, weights);
  const componentByNode: Record<string, { scc_id: number; scc_size: number; cyclic_component: boolean; ring_detected: boolean }> = Object.create(null);
  const componentDetails = components.map((members, index) => {
    const cyclic = members.length > 1 || (members.length === 1 && (graph[members[0]] || []).includes(members[0]));
    const ringDetected = cyclic && members.length >= 3;
    const edges = members.flatMap((source) => (graph[source] || [])
      .filter((target) => members.includes(target))
      .map((target) => ({ from_provider: source, to_provider: target, event_count: weights[source]?.[target] ?? 1 })));
    const repeatedEventCount = edges.filter((edge) => edge.from_provider !== edge.to_provider)
      .reduce((sum, edge) => sum + Math.max(0, edge.event_count - 1), 0);
    const repeatedSelfLoopEventCount = edges.filter((edge) => edge.from_provider === edge.to_provider)
      .reduce((sum, edge) => sum + Math.max(0, edge.event_count - 1), 0);
    const detail = { scc_id: index + 1, providers: members, size: members.length, cyclic_component: cyclic,
      ring_detected: ringDetected, cycle_path: ringDetected ? findCyclePath(members, graph) : null,
      internal_edges: edges, repeated_event_count: repeatedEventCount, repeated_self_loop_event_count: repeatedSelfLoopEventCount };
    for (const node of members) componentByNode[node] = { scc_id: index + 1, scc_size: members.length, cyclic_component: cyclic, ring_detected: ringDetected };
    return detail;
  });

  const allWeights = Object.values(weights).flatMap((targets) => Object.values(targets));
  const out: Record<string, any> = Object.create(null);
  for (const node of Object.keys(graph)) {
    const inNeighbors = Object.keys(graph).filter((source) => (graph[source] || []).includes(node));
    const outNeighbors = graph[node] || [];
    const incomingEvents = inNeighbors.reduce((sum, source) => sum + (weights[source]?.[node] ?? 1), 0);
    const outgoingEvents = outNeighbors.reduce((sum, target) => sum + (weights[node]?.[target] ?? 1), 0);
    const member = componentByNode[node] || { scc_id: null, scc_size: 1, cyclic_component: false, ring_detected: false };
    out[node] = { ...member, pagerank: ranks[node] ?? 0, in_degree: inNeighbors.length, out_degree: outNeighbors.length,
      weighted_in_degree: incomingEvents, weighted_out_degree: outgoingEvents,
      incident_referral_events: incomingEvents + outgoingEvents,
      neighbor_count: new Set([...inNeighbors.filter((source) => source !== node), ...outNeighbors.filter((target) => target !== node)]).size };
  }
  // Explicitly preserve event count vs unique directed relationship count for callers.
  return { signals: out, sccs: componentDetails, uniqueDirectedEdges: Object.values(graph).reduce((sum, neighbors) => sum + neighbors.length, 0), referralEvents: referrals.length, edgeWeights: weights, maximumEdgeWeight: allWeights.length ? Math.max(...allWeights) : 0 };
}

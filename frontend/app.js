(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const PAGE_SIZE = 12;
  const state = {
    view: 'overview', health: null, summary: null, providers: [], claims: [], referrals: [], cases: [], graph: { nodes: [], edges: [] },
    referralsAvailable: false,
    trends: { snapshots: [], note: '' }, analytics: null,
    meta: { specialties: ['Cardiology', 'General Medicine', 'Orthopedics', 'Dermatology', 'Neurology', 'Other'], case_statuses: ['PENDING REVIEW', 'UNDER INVESTIGATION', 'RESOLVED', 'DISMISSED'] },
    audit: [], providerPage: 1, claimPage: 1, referralPage: 1, providerSort: 'risk_score', providerDirection: 'desc',
    form: null, loaded: false, graphFilter: 'all', graphQuery: '',
  };

  function el(tag, options = {}, text = undefined) {
    const node = document.createElement(tag);
    Object.entries(options).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      if (key === 'className') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'dataset') Object.entries(value).forEach(([k, v]) => { node.dataset[k] = String(v); });
      else if (key === 'onClick') node.addEventListener('click', value);
      else if (key === 'attrs') Object.entries(value).forEach(([k, v]) => node.setAttribute(k, String(v)));
      else if (key === 'value') node.value = value;
      else if (key === 'checked') node.checked = Boolean(value);
      else if (key === 'disabled') node.disabled = Boolean(value);
      else if (key === 'selected') node.selected = Boolean(value);
      else if (key === 'htmlFor') node.htmlFor = value;
      else node.setAttribute(key, String(value));
    });
    if (text !== undefined) node.textContent = String(text);
    return node;
  }
  function svgEl(tag, attrs = {}, text = undefined) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
    if (text !== undefined) node.textContent = String(text);
    return node;
  }
  function replace(node, children) { node.replaceChildren(...children.filter(Boolean)); }
  function button(label, className, onClick, attrs = {}) {
    return el('button', { type: 'button', className, onClick, ...attrs }, label);
  }
  function money(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value));
  }
  function number(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
    return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Number(value));
  }
  function score(value) { return value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(1); }
  function riskClass(value) { return `risk-${String(value || 'INSUFFICIENT DATA').toLowerCase().replace(/\s+/g, '-')}`; }
  function statusClass(value) { return `status-${String(value || '').toLowerCase().replace(/\s+/g, '-')}`; }
  function riskBadge(value) { return el('span', { className: `risk-badge ${riskClass(value)}` }, value || 'INSUFFICIENT DATA'); }
  function statusBadge(value) { return el('span', { className: `status-badge ${statusClass(value)}` }, value || '—'); }
  function metricCell(label, value) {
    const wrap = el('div', { className: 'detail-metric' });
    wrap.append(el('span', {}, label), el('strong', {}, value));
    return wrap;
  }
  async function api(url, options = {}) {
    const config = { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } };
    const response = await fetch(url, { ...config, cache: 'no-store' });
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) throw new Error(payload && typeof payload === 'object' ? (payload.error || payload.detail || `Request failed (${response.status})`) : `Request failed (${response.status})`);
    const responseVersion = Number(response.headers.get('x-hfi-data-version'));
    if (payload && typeof payload === 'object' && Number.isFinite(responseVersion)) {
      Object.defineProperty(payload, '__hfiDataVersion', { value: responseVersion, enumerable: false, configurable: true });
    }
    return payload;
  }
  function notify(message, kind = 'success') {
    const toast = $('#toast');
    toast.textContent = message;
    toast.style.borderColor = kind === 'error' ? '#8e3e4c' : '#315b4b';
    toast.style.background = kind === 'error' ? '#331f2a' : '#132e28';
    toast.style.color = kind === 'error' ? '#ffc3cb' : '#b9f5dd';
    toast.classList.remove('hidden');
    window.setTimeout(() => toast.classList.add('hidden'), 3400);
  }
  function alertMessage(message, warning = false) {
    const target = $('#globalAlert');
    target.textContent = message;
    target.classList.toggle('warning', warning);
    target.classList.remove('hidden');
  }
  function clearAlert() { $('#globalAlert').classList.add('hidden'); }
  function emptyState(title, detail) {
    const box = el('div', { className: 'empty-state' });
    box.append(el('strong', {}, title), el('span', {}, detail));
    return box;
  }
  function showView(name) {
    state.view = name;
    $$('.view').forEach((view) => view.classList.toggle('active', view.id === `view-${name}`));
    $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === name));
    const names = { overview: 'Overview', providers: 'Providers', claims: 'Claims', referrals: 'Referral network', investigations: 'Investigations', methodology: 'Methodology' };
    $('#pageCrumb').textContent = names[name] || 'Overview';
    const adds = { providers: ['＋ Add provider', () => openForm('provider')], claims: ['＋ Add claim', () => openForm('claim')], referrals: ['＋ Add referral', () => openForm('referral')], investigations: ['＋ Open investigation', () => openForm('case')] };
    const action = adds[name];
    $('#topAddButton').textContent = action ? action[0] : '＋ Add provider';
    $('#topAddButton').onclick = action ? action[1] : () => openForm('provider');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function loadAll(showToast = false, consistencyAttempt = 0) {
    $('#refreshButton').disabled = true;
    $('#refreshButton').textContent = '↻ Loading…';
    const sources = [
      ['health', '/api/health'], ['summary', '/api/summary'], ['providers', '/api/providers'], ['claims', '/api/claims'],
      ['referrals', '/api/referrals'], ['cases', '/api/investigations'], ['graph', '/api/graph'], ['trends', '/api/trends'],
      ['analytics', '/api/analytics'], ['meta', '/api/meta'], ['audit', '/api/audit?limit=100'],
    ];
    const responses = await Promise.allSettled(sources.map(([, url]) => api(url)));
    const failures = [];
    responses.forEach((result, index) => {
      const key = sources[index][0];
      if (result.status === 'rejected') {
        failures.push(`${key}: ${result.reason?.message || 'request failed'}`);
        // Do not continue to show a previously fetched snapshot as current after a failed refresh.
        if (['health', 'summary', 'analytics', 'graph'].includes(key)) state[key] = null;
        else if (key === 'meta') state.meta = { specialties: ['Cardiology', 'General Medicine', 'Orthopedics', 'Dermatology', 'Neurology', 'Other'], case_statuses: ['PENDING REVIEW', 'UNDER INVESTIGATION', 'RESOLVED', 'DISMISSED'], risk_levels: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT DATA'] };
        else if (key === 'providers' || key === 'claims' || key === 'referrals' || key === 'cases' || key === 'audit') state[key] = [];
        if (key === 'referrals') state.referralsAvailable = false;
        else if (key === 'trends') state.trends = { snapshots: [], note: 'History could not be loaded; previous data is not shown as current.' };
        return;
      }
      const value = result.value;
      if (key === 'health') {
        state.health = value;
        $('#storageStatus').textContent = value.storage === 'sqlite' ? 'Local SQLite' : String(value.storage || 'Storage');
        $('#modelVersion').textContent = `Model ${value.model_version || '—'}`;
      } else {
        state[key] = value;
        if (key === 'referrals') state.referralsAvailable = true;
      }
    });
    if (state.providers && !Array.isArray(state.providers)) state.providers = state.providers.items || [];
    if (state.claims && !Array.isArray(state.claims)) state.claims = state.claims.items || [];
    if (state.referrals && !Array.isArray(state.referrals)) state.referrals = state.referrals.items || [];
    // All dashboard areas must describe one data version. If another client writes while
    // these parallel GETs are in flight, retry instead of combining new counts with old SCCs.
    const loadedVersions = [
      state.health?.__hfiDataVersion, state.health?.data_version,
      state.meta?.__hfiDataVersion, state.meta?.data_version,
      state.summary?.__hfiDataVersion, state.summary?.data_version,
      state.providers?.__hfiDataVersion, state.claims?.__hfiDataVersion,
      state.referrals?.__hfiDataVersion, state.cases?.__hfiDataVersion,
      state.trends?.__hfiDataVersion, state.analytics?.__hfiDataVersion, state.analytics?.summary?.data_version,
      state.graph?.__hfiDataVersion, state.graph?.data_version,
      state.audit?.__hfiDataVersion,
    ].filter((value) => value !== undefined && value !== null && Number.isFinite(Number(value))).map(Number);
    if (new Set(loadedVersions).size > 1) {
      if (consistencyAttempt < 2) return loadAll(showToast, consistencyAttempt + 1);
      state.summary = null; state.analytics = null; state.graph = null;
      failures.push('network and dashboard data versions do not match; refresh again after concurrent changes finish');
    }
    if (state.summary) {
      $('#dataVersion').textContent = `Data v${state.summary.data_version ?? '—'}`;
      $('#modelVersionInline').textContent = state.summary.model_version || '—';
      $('#methodModelVersion').textContent = `Model ${state.summary.model_version || '—'}`;
      $('#methodDataVersion').textContent = `Data version ${state.summary.data_version ?? '—'}`;
      $('#methodThresholds').textContent = 'Thresholds: Critical ≥80 · High ≥60 · Medium ≥35';
      $('#calculatedAt').textContent = state.summary.calculated_at ? new Date(state.summary.calculated_at).toLocaleString() : 'Unavailable';
      $('#summaryAnalyticsStatus').textContent = `Analytics status: ${state.summary.analytics_status || 'current'}`;
      if (state.summary.analytics_warning) alertMessage(`Analytics warning: ${state.summary.analytics_warning}`, true);
      else if (!failures.length) clearAlert();
    }
    $('#navProviderCount').textContent = String(state.providers?.length ?? '—');
    state.loaded = true;
    renderAll();
    if (failures.length) alertMessage(`Some data could not be refreshed. ${failures.join(' · ')}`, true);
    if (showToast && !failures.length) notify('Dashboard refreshed from the current database.');
    $('#refreshButton').disabled = false;
    $('#refreshButton').textContent = '↻ Refresh';
  }
  function renderAll() {
    renderMetrics(); renderTopProviders(); renderRiskDistribution(); renderSpecialtyBars(); renderRings(); renderTrends();
    renderProviderDirectory(); renderClaims(); renderReferrals(); renderGraph(); renderCases(); renderAudit(); renderSpecialtyFilter();
  }
  function renderMetrics() {
    const s = state.summary;
    const host = $('#summaryMetrics');
    if (!s) return replace(host, [emptyState('Analytics are unavailable', 'Review the message above and restart the backend after checking the server log.')]);
    const metrics = [
      ['Active providers', number(s.active_providers), `${number(s.providers_analyzed)} total provider records`, '♙'],
      ['Claims analyzed', number(s.claims_processed), 'Synthetic records · all current claims', '▤'],
      ['Total billed', money(s.total_billed_amount), 'Sum of claim_amount fields', '₹'],
      ['Referral events', number(s.referral_events), `${number(s.unique_referral_relationships)} unique directed links`, '⌘'],
      ['Critical', number(s.critical_providers), 'Score ≥ 80', '◆'],
      ['High risk', number(s.high_risk_providers), 'Score from 60 to <80', '↗'],
      ['Cyclic components', number(s.rings_detected), '3+ providers with directed cycles', '◎'],
      ['Open investigations', number(s.open_investigations), 'Pending review + under investigation', '☷'],
    ];
    replace(host, metrics.map(([label, value, foot, icon]) => {
      const card = el('article', { className: 'metric-card' });
      const heading = el('div', { className: 'metric-head' }); heading.append(el('span', {}, label), el('span', { className: 'metric-symbol' }, icon));
      card.append(heading, el('div', { className: 'metric-value' }, value), el('div', { className: 'metric-foot' }, foot));
      return card;
    }));
  }
  function td(textValue, options = {}) {
    const cell = el('td', options);
    if (textValue instanceof Node) cell.append(textValue); else cell.textContent = textValue === null || textValue === undefined ? '—' : String(textValue);
    return cell;
  }
  function providerCell(provider) {
    const box = el('div');
    const name = el('strong', {}, provider.provider_id);
    box.append(name, el('span', { className: 'cell-sub' }, provider.provider_name || 'Unnamed provider'));
    return box;
  }
  function renderTopProviders() {
    const tbody = $('#topProvidersBody');
    const top = [...state.providers].sort((a, b) => (b.risk_score ?? -1) - (a.risk_score ?? -1)).slice(0, 8);
    if (!top.length) return replace(tbody, []);
    replace(tbody, top.map((provider) => {
      const row = el('tr', { attrs: { tabindex: '0', role: 'button', 'aria-label': `View ${provider.provider_id}` }, onClick: () => showProviderDetail(provider.provider_id) });
      row.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') showProviderDetail(provider.provider_id); });
      row.append(td(providerCell(provider)), td(provider.specialty), td(score(provider.risk_score)), td(riskBadge(provider.risk_level)), td(number(provider.claim_count)), td(provider.specialty_z_score == null ? '—' : Number(provider.specialty_z_score).toFixed(2)));
      return row;
    }));
  }
  function barList(hostId, rows, maximum, valueFormat = number, colorClass = () => '') {
    const host = $(hostId);
    if (!rows.length) return replace(host, [emptyState('No data to chart', 'Records will appear here when available.')]);
    const max = Math.max(1, maximum, ...rows.map((row) => Number(row.value) || 0));
    replace(host, rows.map((row) => {
      const line = el('div', { className: 'bar-row' });
      const label = el('span', { className: 'bar-label', attrs: { title: row.label } }, row.label);
      const track = el('div', { className: 'bar-track' });
      const fill = el('div', { className: `bar-fill ${colorClass(row)}` }); fill.style.width = `${Math.min(100, Math.max(0, Number(row.value) / max * 100))}%`;
      fill.setAttribute('aria-label', `${row.label}: ${valueFormat(row.value)}`);
      track.append(fill);
      line.append(label, track, el('span', { className: 'bar-value' }, valueFormat(row.value)));
      return line;
    }));
  }
  function renderRiskDistribution() {
    const rows = (state.analytics?.risk_distribution || []).map((row) => ({ label: row.category, value: row.value }));
    const classByCategory = { Critical: 'risk-critical-fill', High: 'risk-high-fill', Medium: 'risk-medium-fill', Low: 'risk-low-fill', 'Insufficient data': 'risk-insufficient-data-fill' };
    barList('#riskDistribution', rows, state.providers.length, number, (row) => classByCategory[row.label] || '');
  }
  function renderSpecialtyBars() {
    const rows = (state.analytics?.specialty_summary || []).filter((row) => row.claims > 0).map((row) => ({ label: row.specialty, value: row.billed_amount, claims: row.claims }));
    barList('#specialtyBars', rows, Math.max(1, ...rows.map((row) => row.value)), money);
  }
  function ringCard(component) {
    const card = el('article', { className: 'ring-card' });
    const edges = Array.isArray(component.internal_edges) ? component.internal_edges : [];
    const totalEvents = edges.reduce((sum, edge) => sum + Math.max(1, Number(edge.event_count) || 1), 0);
    const head = el('div', { className: 'ring-card-head' });
    const title = el('strong', {}, `SCC #${component.scc_id} · ${component.size} providers`);
    const meta = el('span', { className: 'ring-card-meta' }, `${edges.length} unique links · ${totalEvents} referral events`);
    head.append(title, meta);
    card.append(head);
    card.append(el('div', { className: 'ring-path-caption' }, 'Verified directed cycle'));
    card.append(el('div', { className: 'cycle-path' }, component.cycle_path?.join(' → ') || 'No verified cycle path available'));
    const edgeSection = el('div', { className: 'ring-edge-section' });
    edgeSection.append(el('div', { className: 'ring-edge-title' }, 'Internal dependencies'));
    const edgeList = el('div', { className: 'ring-edge-list', attrs: { 'aria-label': `Internal dependencies for SCC ${component.scc_id}` } });
    edges.forEach((edge) => {
      const eventCount = Math.max(1, Number(edge.event_count) || 1);
      const item = el('span', { className: 'ring-edge-item', attrs: { title: `${edge.from_provider} refers to ${edge.to_provider} in ${eventCount} event(s)` } });
      item.append(el('span', { className: 'ring-edge-route' }, `${edge.from_provider} → ${edge.to_provider}`));
      if (eventCount > 1) item.append(el('span', { className: 'ring-edge-count' }, `×${eventCount}`));
      edgeList.append(item);
    });
    if (!edges.length) edgeList.append(el('span', { className: 'ring-edge-empty' }, 'No internal dependencies recorded'));
    edgeSection.append(edgeList);
    card.append(edgeSection);
    return card;
  }
  function renderRings() {
    const rings = state.analytics?.rings || [];
    const compact = rings.slice(0, 3).map(ringCard);
    const version = state.analytics?.summary?.data_version;
    const calculatedAt = state.analytics?.summary?.calculated_at;
    const freshness = version === undefined
      ? 'Live network snapshot unavailable.'
      : `Live SCC analysis · Data v${version} · ${calculatedAt ? new Date(calculatedAt).toLocaleString() : 'calculation time unavailable'} · ${rings.length} reportable ring(s)`;
    if ($('#ringFreshness')) $('#ringFreshness').textContent = freshness;
    replace($('#ringList'), compact.length ? compact : [emptyState('No reportable rings', 'A provider or claim alone does not create a ring. A linked referral event must close a directed cycle of at least 3 providers.')]);
    replace($('#ringListFull'), rings.length ? rings.map(ringCard) : [emptyState('No reportable rings in the current data', 'The current database was recalculated. Two-provider cycles and one-provider self-loops are shown as smaller cycles where applicable, but are excluded from the 3+ provider ring count.')]);
  }
  function renderTrends() {
    const host = $('#trendChart');
    const rawSnapshots = state.trends?.snapshots || [];
    // A scoring-model upgrade can save another snapshot at the same data_version.
    // This chart is total billed amount (a data metric), so keep only the latest
    // snapshot per data version instead of drawing a misleading duplicate point.
    const byDataVersion = new Map();
    for (const snapshot of rawSnapshots) {
      const key = Number(snapshot.data_version);
      const existing = byDataVersion.get(key);
      if (!existing || String(snapshot.calculated_at) >= String(existing.calculated_at)) byDataVersion.set(key, snapshot);
    }
    const snapshots = [...byDataVersion.values()].sort((a, b) => Number(a.data_version) - Number(b.data_version));
    $('#trendStatus').textContent = rawSnapshots.length > snapshots.length
      ? `${snapshots.length} data versions · ${rawSnapshots.length} snapshots`
      : snapshots.length > 1 ? `${snapshots.length} data versions` : 'Baseline';
    $('#trendNote').textContent = state.trends?.note || 'Stored snapshots include data and model versions. Risk scores are comparable only within the same model version.';
    if (snapshots.length < 2) return replace(host, [emptyState('History starts with the next data change', 'This baseline is not shown as a historical trend. Add, edit or remove a provider, claim or referral to save a new verified snapshot.')]);
    const points = snapshots.map((snapshot) => ({ x: snapshot.calculated_at, y: Number(snapshot.summary.total_billed_amount) || 0, version: snapshot.data_version }));
    const w = 740, h = 150, pad = { left: 12, right: 12, top: 16, bottom: 24 };
    const max = Math.max(1, ...points.map((point) => point.y));
    const coords = points.map((point, i) => ({ x: pad.left + (points.length === 1 ? 0 : i / (points.length - 1)) * (w - pad.left - pad.right), y: h - pad.bottom - point.y / max * (h - pad.top - pad.bottom) }));
    const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}`, class: 'trend-svg', role: 'img', 'aria-label': 'Saved snapshot total billed amount trend' });
    [0.25, 0.5, 0.75].forEach((ratio) => svg.append(svgEl('line', { x1: pad.left, y1: h - pad.bottom - ratio * (h - pad.top - pad.bottom), x2: w - pad.right, y2: h - pad.bottom - ratio * (h - pad.top - pad.bottom), stroke: '#22334c', 'stroke-dasharray': '3 5' })));
    svg.append(svgEl('polyline', { points: coords.map((point) => `${point.x},${point.y}`).join(' '), fill: 'none', stroke: '#7faaff', 'stroke-width': 2.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    coords.forEach((point, i) => {
      const circle = svgEl('circle', { cx: point.x, cy: point.y, r: 4, fill: '#9dc0ff', stroke: '#101a2b', 'stroke-width': 2 });
      circle.append(svgEl('title', {}, `Data v${points[i].version}: ${money(points[i].y)} · ${new Date(points[i].x).toLocaleString()}`)); svg.append(circle);
    });
    const first = points[0], last = points[points.length - 1];
    svg.append(svgEl('text', { x: pad.left, y: h - 5, fill: '#8196b6', 'font-size': 10 }, `v${first.version}`));
    svg.append(svgEl('text', { x: w - pad.right, y: h - 5, fill: '#8196b6', 'font-size': 10, 'text-anchor': 'end' }, `v${last.version}`));
    replace(host, [svg]);
  }
  function filteredProviders() {
    const q = ($('#providerSearch')?.value || '').trim().toLowerCase();
    const risk = $('#providerRiskFilter')?.value || '';
    const status = $('#providerStatusFilter')?.value || 'ALL';
    let rows = state.providers.filter((item) => !q || [item.provider_id, item.provider_name, item.specialty, item.city].some((value) => String(value || '').toLowerCase().includes(q)));
    if (risk) rows = rows.filter((item) => item.risk_level === risk);
    if (status !== 'ALL') rows = rows.filter((item) => item.status === status);
    const key = state.providerSort;
    const dir = state.providerDirection === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      if (a[key] == null && b[key] != null) return 1;
      if (b[key] == null && a[key] != null) return -1;
      if (typeof a[key] === 'number' && typeof b[key] === 'number') return (a[key] - b[key]) * dir;
      return String(a[key] ?? '').localeCompare(String(b[key] ?? ''), undefined, { numeric: true, sensitivity: 'base' }) * dir;
    });
    return rows;
  }
  function paginate(rows, page, hostId, renderPage) {
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const safePage = Math.min(Math.max(1, page), pages);
    const start = rows.length ? (safePage - 1) * PAGE_SIZE + 1 : 0;
    const end = Math.min(rows.length, safePage * PAGE_SIZE);
    const host = $(hostId);
    const info = el('span', {}, rows.length ? `Showing ${start}–${end} of ${rows.length}` : 'No records');
    const controls = el('div', { className: 'page-controls' });
    const prev = button('‹', 'page-control', () => renderPage(safePage - 1), { disabled: safePage <= 1, attrs: { 'aria-label': 'Previous page' } }); controls.append(prev);
    const shown = new Set([1, pages, safePage - 1, safePage, safePage + 1].filter((p) => p >= 1 && p <= pages));
    let previous = 0;
    [...shown].sort((a, b) => a - b).forEach((p) => {
      if (previous && p - previous > 1) controls.append(el('span', {}, '…'));
      controls.append(button(String(p), `page-control ${p === safePage ? 'active' : ''}`, () => renderPage(p), { attrs: { 'aria-label': `Page ${p}`, 'aria-current': p === safePage ? 'page' : 'false' } })); previous = p;
    });
    controls.append(button('›', 'page-control', () => renderPage(safePage + 1), { disabled: safePage >= pages, attrs: { 'aria-label': 'Next page' } }));
    replace(host, [info, controls]);
    return { page: safePage, rows: rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE) };
  }
  function renderProviderDirectory() {
    const rows = filteredProviders();
    const page = paginate(rows, state.providerPage, '#providersPagination', (next) => { state.providerPage = next; renderProviderDirectory(); });
    state.providerPage = page.page;
    replace($('#providersBody'), page.rows.map((provider) => {
      const row = el('tr');
      const status = statusBadge(provider.status);
      const actions = el('div', { className: 'action-group' });
      actions.append(button('View', 'mini-button', () => showProviderDetail(provider.provider_id)), button('Edit', 'mini-button', () => openForm('provider', provider)));
      actions.append(button(provider.status === 'INACTIVE' ? 'Activate' : 'Deactivate', 'mini-button', () => toggleProviderStatus(provider)));
      actions.append(button('Delete', 'mini-button danger', () => deleteProvider(provider)));
      row.append(td(providerCell(provider)), td(provider.specialty), td(provider.city), td(status), td(score(provider.risk_score)), td(number(provider.claim_count)), td(actions, { className: 'align-right' }));
      return row;
    }));
    if (!page.rows.length) replace($('#providersBody'), [emptyRow(7, 'No providers match these filters.')]);
  }
  function emptyRow(cols, textValue) { const row = el('tr'); const cell = el('td', { attrs: { colspan: cols } }); cell.append(emptyState('No matching records', textValue)); row.append(cell); return row; }
  function renderClaims() {
    const q = ($('#claimSearch')?.value || '').trim().toLowerCase();
    const specialty = $('#claimSpecialtyFilter')?.value || '';
    const rows = state.claims.filter((item) => (!q || [item.claim_id, item.provider_id, item.patient_id, item.procedure_code, item.specialty, item.referred_to].some((value) => String(value || '').toLowerCase().includes(q))) && (!specialty || item.specialty === specialty));
    const page = paginate(rows, state.claimPage, '#claimsPagination', (next) => { state.claimPage = next; renderClaims(); }); state.claimPage = page.page;
    replace($('#claimsBody'), page.rows.map((claim) => {
      const row = el('tr'); const provider = state.providers.find((x) => x.provider_id === claim.provider_id);
      const actions = el('div', { className: 'action-group' }); actions.append(button('Edit', 'mini-button', () => openForm('claim', claim)), button('Delete', 'mini-button danger', () => deleteClaim(claim)));
      row.append(td(claim.claim_id), td(provider ? `${provider.provider_id} · ${provider.provider_name}` : claim.provider_id), td(claim.procedure_code), td(claim.specialty), td(claim.claim_date), td(money(claim.claim_amount)), td(actions, { className: 'align-right' })); return row;
    }));
    if (!page.rows.length) replace($('#claimsBody'), [emptyRow(7, 'Try a different search term or specialty.')]);
  }
  function renderSpecialtyFilter() {
    const select = $('#claimSpecialtyFilter'); if (!select) return;
    const current = select.value;
    const specialties = [...new Set(state.claims.map((claim) => claim.specialty).filter(Boolean))].sort();
    replace(select, [el('option', { value: '' }, 'All specialties'), ...specialties.map((s) => el('option', { value: s }, s))]);
    select.value = specialties.includes(current) ? current : '';
  }
  function renderReferrals() {
    const q = ($('#referralSearch')?.value || '').trim().toLowerCase();
    const rows = state.referrals.filter((item) => !q || [item.referral_id, item.from_provider, item.to_provider, item.reason].some((value) => String(value || '').toLowerCase().includes(q)));
    const page = paginate(rows, state.referralPage, '#referralsPagination', (next) => { state.referralPage = next; renderReferrals(); }); state.referralPage = page.page;
    replace($('#referralsBody'), page.rows.map((referral) => {
      const row = el('tr'); const actions = el('div', { className: 'action-group' });
      actions.append(button('Edit', 'mini-button', () => openForm('referral', referral)), button('Delete', 'mini-button danger', () => deleteReferral(referral)));
      row.append(td(referral.referral_id), td(referral.from_provider), td(referral.to_provider), td(referral.source_claim_id ? `${referral.reason} · claim ${referral.source_claim_id}` : referral.reason), td(referral.event_date || 'Date not supplied'), td(actions, { className: 'align-right' })); return row;
    }));
    if (!page.rows.length) replace($('#referralsBody'), [emptyRow(6, 'Try a different search term.')]);
  }
  // Route each directed dependency around provider nodes. Candidate quadratic paths are
  // scored against every unrelated node circle; this prevents arrow shafts/heads from
  // visually entering a third provider. Reciprocal dependencies are also discouraged from
  // occupying the same path, while ordinary edge crossings remain allowed when unavoidable.
  function buildGraphEdgeRoute(options) {
    const {
      a, b, sourceId, targetId, sourceRadius, targetRadius, preferredBend,
      obstacles, priorRoutes = [], width, height,
    } = options;
    const dx = b.x - a.x, dy = b.y - a.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const candidates = [];
    const usedBends = new Set();
    const addBend = (value) => {
      const rounded = Math.round(value * 100) / 100;
      if (!usedBends.has(rounded)) { usedBends.add(rounded); candidates.push(rounded); }
    };
    addBend(preferredBend);
    addBend(0);
    addBend(-preferredBend);
    for (let amount = 8; amount <= 176; amount += 8) {
      addBend(amount);
      addBend(-amount);
    }

    const reverseRoute = priorRoutes.find((route) => route.from === targetId && route.to === sourceId);
    let best = null;
    for (const bend of candidates) {
      const controlX = (a.x + b.x) / 2 - (dy / length) * bend;
      const controlY = (a.y + b.y) / 2 + (dx / length) * bend;
      const sourceDx = controlX - a.x, sourceDy = controlY - a.y;
      const targetDx = b.x - controlX, targetDy = b.y - controlY;
      const sourceLen = Math.max(1, Math.hypot(sourceDx, sourceDy));
      const targetLen = Math.max(1, Math.hypot(targetDx, targetDy));
      const x1 = a.x + sourceDx / sourceLen * (sourceRadius + 2);
      const y1 = a.y + sourceDy / sourceLen * (sourceRadius + 2);
      const x2 = b.x - targetDx / targetLen * (targetRadius + 3);
      const y2 = b.y - targetDy / targetLen * (targetRadius + 3);
      const samples = [];
      let score = Math.abs(bend - preferredBend) * 0.65 + Math.abs(bend) * 0.025;
      let collisionCount = 0;
      let overflowCount = 0;
      let overlapRatio = 0;
      for (let step = 1; step < 32; step++) {
        const t = step / 32, u = 1 - t;
        samples.push({
          x: u * u * x1 + 2 * u * t * controlX + t * t * x2,
          y: u * u * y1 + 2 * u * t * controlY + t * t * y2,
        });
      }

      // A very large penalty makes node clearance more important than retaining a
      // preferred bend. The six-pixel gutter also protects labels and arrow tips.
      for (const obstacle of obstacles) {
        if (obstacle.provider_id === sourceId || obstacle.provider_id === targetId) continue;
        let minDistance = Infinity;
        for (const point of samples) {
          minDistance = Math.min(minDistance, Math.hypot(point.x - obstacle.x, point.y - obstacle.y));
        }
        const clearance = obstacle.radius + 6;
        if (minDistance < clearance) {
          collisionCount++;
          const penetration = clearance - minDistance;
          score += 2200 + penetration * penetration * 35;
        }
      }

      // Keep routes within the SVG viewBox; outside routes must not be clipped.
      for (const point of samples) {
        const overflow = Math.max(0, 18 - point.x, point.x - (width - 18), 18 - point.y, point.y - (height - 18));
        if (overflow > 0) { overflowCount++; score += 1800 + overflow * overflow * 30; }
      }

      // Reciprocal edges need distinct lanes. Penalize only substantial overlap, not
      // a single legitimate edge crossing, so routing does not produce huge detours.
      if (reverseRoute?.samples?.length) {
        let nearCount = 0;
        for (const point of samples) {
          let nearest = Infinity;
          for (const other of reverseRoute.samples) {
            nearest = Math.min(nearest, Math.hypot(point.x - other.x, point.y - other.y));
          }
          if (nearest < 6) nearCount++;
        }
        overlapRatio = nearCount / Math.max(1, samples.length);
        if (overlapRatio > 0.22) score += 4200 * overlapRatio;
      }

      const candidate = {
        bend, controlX, controlY, x1, y1, x2, y2, samples, score, collisionCount, overflowCount, overlapRatio,
        d: `M ${x1} ${y1} Q ${controlX} ${controlY} ${x2} ${y2}`,
      };
      if (!best || candidate.score < best.score) best = candidate;
      if (best === candidate && collisionCount === 0 && overflowCount === 0 && overlapRatio <= 0.22 && Math.abs(bend - preferredBend) < 0.001) break;
    }
    return best;
  }

  function renderGraph() {
    const host = $('#networkViz');
    const nodes = [...(state.graph?.nodes || [])].sort((a, b) =>
      String(a.provider_id).localeCompare(String(b.provider_id), undefined, { numeric: true, sensitivity: 'base' }));
    const edges = [...(state.graph?.edges || [])].sort((a, b) =>
      String(a.from_provider).localeCompare(String(b.from_provider), undefined, { numeric: true, sensitivity: 'base' }) ||
      String(a.to_provider).localeCompare(String(b.to_provider), undefined, { numeric: true, sensitivity: 'base' }));
    const rings = state.analytics?.rings || [];
    const dataVersion = state.graph?.data_version ?? state.analytics?.summary?.data_version;
    const calculatedAt = state.graph?.calculated_at ?? state.analytics?.summary?.calculated_at;

    if ($('#graphFreshness')) {
      $('#graphFreshness').textContent = dataVersion === undefined
        ? 'Live graph snapshot unavailable.'
        : `Recomputed from database · Data v${dataVersion} · ${calculatedAt ? new Date(calculatedAt).toLocaleString() : 'calculation time unavailable'} · ${rings.length} reportable ring(s)`;
    }
    $('#graphCounts').textContent = `${nodes.length} providers · ${edges.length} unique directed dependencies · ${state.referrals.length} referral events · ${rings.length} reportable rings`;
    if (!nodes.length) {
      return replace(host, [emptyState('Graph unavailable', 'Live graph data could not be loaded. Refresh the dashboard to retry the backend graph endpoint.')]);
    }

    // Keep the original simple circular network layout. Ring/cycle status affects styling only;
    // SCC membership changes color/highlight only; no alternate layout is introduced.
    const width = 1240, height = 660, cx = width / 2, cy = height / 2, radius = 260;
    const positions = new Map();
    nodes.forEach((node, index) => {
      const angle = -Math.PI / 2 + (index / Math.max(nodes.length, 1)) * Math.PI * 2;
      positions.set(node.provider_id, { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
    });

    const svg = svgEl('svg', {
      viewBox: `0 0 ${width} ${height}`, role: 'img',
      'aria-label': 'Circular directed provider referral network. Arrow tips show referral direction. Each edge is one unique directed dependency; badges show repeated referral event counts.'
    });
    const defs = svgEl('defs');
    const markers = [
      ['arrow-normal-v2311', '#d7e8ff', '#29466b'],
      ['arrow-ring-v2311', '#f0d9ff', '#5c397b'],
    ];
    markers.forEach(([id, fill, outline]) => {
      const marker = svgEl('marker', {
        id, markerWidth: 16, markerHeight: 16, viewBox: '0 0 16 16',
        refX: 14.5, refY: 8, orient: 'auto', markerUnits: 'userSpaceOnUse'
      });
      marker.append(svgEl('path', { d: 'M1,1 L15,8 L1,15 z', fill, stroke: outline, 'stroke-width': .9, 'stroke-linejoin': 'round' }));
      defs.append(marker);
    });
    svg.append(defs);
    const viewport = svgEl('g', { class: 'graph-viewport' });
    const orbitLayer = svgEl('g', { class: 'graph-orbit-layer', 'aria-hidden': 'true' });
    orbitLayer.append(svgEl('circle', {
      cx, cy, r: radius, fill: 'none', stroke: '#263a57', 'stroke-width': 1.2,
      'stroke-dasharray': '3 7', 'stroke-opacity': .62, class: 'graph-orbit'
    }));
    const edgeLayer = svgEl('g', { class: 'graph-edge-layer', fill: 'none' });
    const labelLayer = svgEl('g', { class: 'graph-edge-label-layer' });
    const nodeLayer = svgEl('g', { class: 'graph-node-layer' });
    viewport.append(orbitLayer, edgeLayer, labelLayer, nodeLayer);
    svg.append(viewport);

    const nodeById = new Map(nodes.map((node) => [node.provider_id, node]));
    const edgeKey = (from, to) => `${String(from)}\u0000${String(to)}`;
    const edgeKeys = new Set(edges.map((edge) => edgeKey(edge.from_provider, edge.to_provider)));
    const obstacles = nodes.map((node) => {
      const pos = positions.get(node.provider_id);
      return { provider_id: node.provider_id, x: pos.x, y: pos.y, radius: node.ring_detected ? 20.5 : 18 };
    });
    const routedCurves = [];

    edges.forEach((edge, edgeIndex) => {
      const a = positions.get(edge.from_provider), b = positions.get(edge.to_provider);
      const source = nodeById.get(edge.from_provider), target = nodeById.get(edge.to_provider);
      if (!a || !b || !source || !target) return;
      const eventCount = Math.max(1, Number(edge.event_count) || 1);
      const sameScc = source.scc_id !== null && source.scc_id !== undefined && String(source.scc_id) === String(target.scc_id);
      const inRing = Boolean(sameScc && source.ring_detected && target.ring_detected);
      const color = inRing ? '#dcb7ff' : '#a9c5e8';
      const markerId = inRing ? 'arrow-ring-v2311' : 'arrow-normal-v2311';
      const sourceRadius = source.ring_detected ? 21 : 18.5;
      const targetRadius = target.ring_detected ? 21 : 18.5;

      if (edge.from_provider === edge.to_provider) {
        const path = svgEl('path', {
          d: `M ${a.x - 8} ${a.y - 16} C ${a.x - 39} ${a.y - 52}, ${a.x + 39} ${a.y - 52}, ${a.x + 8} ${a.y - 16}`,
          stroke: '#8fa9cc', 'stroke-width': 2.4, 'stroke-opacity': .96,
          'marker-end': 'url(#arrow-normal-v2311)', 'data-from': edge.from_provider, 'data-to': edge.to_provider,
          class: 'graph-edge'
        });
        path.append(svgEl('title', {}, `${edge.from_provider} → itself · ${eventCount} referral event(s); self-loop does not qualify as a reportable ring`));
        edgeLayer.append(path);
        return;
      }

      const reverseExists = edgeKeys.has(edgeKey(edge.to_provider, edge.from_provider));
      // Reciprocal links prefer opposite physical lanes; non-reciprocal links use a
      // modest deterministic preference that may be overridden to clear node circles.
      const preferredBend = reverseExists ? 36 : ((edgeIndex % 7) - 3) * 5;
      const route = buildGraphEdgeRoute({
        a, b, sourceId: edge.from_provider, targetId: edge.to_provider,
        sourceRadius, targetRadius, preferredBend, obstacles, priorRoutes: routedCurves,
        width, height,
      });
      const { controlX, controlY, x1, y1, x2, y2 } = route;
      routedCurves.push({ from: edge.from_provider, to: edge.to_provider, samples: route.samples });
      const widthByEvents = 1.9 + Math.min(1.4, (eventCount - 1) * .18);
      const path = svgEl('path', {
        d: route.d,
        stroke: color, 'stroke-width': inRing ? Math.max(2.25, widthByEvents) : widthByEvents,
        'stroke-opacity': inRing ? .98 : .68,
        'marker-end': `url(#${markerId})`,
        'data-from': edge.from_provider, 'data-to': edge.to_provider,
        'data-route-bend': route.bend,
        'data-node-collisions': route.collisionCount,
        class: 'graph-edge'
      });
      path.append(svgEl('title', {}, `${edge.from_provider} → ${edge.to_provider}; ${eventCount} referral event(s); ${inRing ? 'edge within a reportable ring' : 'unique directed dependency'}; node-clearance routing ${route.collisionCount === 0 ? 'clear' : 'best available path'}`));
      edgeLayer.append(path);

      if (eventCount > 1) {
        // Place repeat-count badges just outside the circular node orbit rather than directly
        // on top of short links between neighbouring providers.
        const midX = (x1 + 2 * controlX + x2) / 4;
        const midY = (y1 + 2 * controlY + y2) / 4;
        const radialX = midX - cx, radialY = midY - cy;
        const radialLength = Math.max(1, Math.hypot(radialX, radialY));
        const labelX = midX + radialX / radialLength * 21;
        const labelY = midY + radialY / radialLength * 21;
        const labelWidth = eventCount >= 10 ? 36 : 32;
        const badge = svgEl('g', { class: 'graph-edge-label', 'data-from': edge.from_provider, 'data-to': edge.to_provider });
        badge.append(svgEl('rect', {
          x: labelX - labelWidth / 2, y: labelY - 10, width: labelWidth, height: 20, rx: 7,
          fill: '#091321', stroke: color, 'stroke-width': 1.3
        }));
        badge.append(svgEl('text', {
          x: labelX, y: labelY + 4, fill: '#f7faff', 'font-size': 11,
          'font-weight': 850, 'text-anchor': 'middle'
        }, `×${eventCount}`));
        labelLayer.append(badge);
      }
    });

    nodes.forEach((node) => {
      const pos = positions.get(node.provider_id);
      if (!pos) return;
      const isRing = Boolean(node.ring_detected);
      const r = isRing ? 20.5 : 18;
      const fill = isRing ? '#51386c' : node.status === 'INACTIVE' ? '#273449' : '#1b3555';
      const stroke = isRing ? '#e1c3ff' : node.status === 'INACTIVE' ? '#a1aec1' : '#a2c0ed';
      const group = svgEl('g', {
        tabindex: 0, role: 'button', class: 'network-node', 'data-provider-id': node.provider_id,
        'aria-label': `Open ${node.provider_id}, ${node.provider_name || 'provider'}, ${isRing ? 'member of reportable referral ring' : 'not in a reportable ring'}`,
        style: 'cursor:pointer'
      });
      group.append(svgEl('circle', { cx: pos.x, cy: pos.y, r, fill, stroke, 'stroke-width': isRing ? 2.3 : 1.5 }));
      group.append(svgEl('text', {
        x: pos.x, y: pos.y + 3.5, fill: '#f6f9ff', 'font-size': 11.1,
        'font-weight': 800, 'text-anchor': 'middle', 'paint-order': 'stroke', stroke: '#172a45', 'stroke-width': .25
      }, node.provider_id));
      group.append(svgEl('title', {}, `${node.provider_id} · ${node.provider_name || 'Unnamed provider'} · ${node.specialty || 'Unspecified specialty'} · ${node.city || 'City not supplied'} · ${node.status || 'status unknown'} · SCC #${node.scc_id ?? '—'} (${node.scc_size ?? 1} provider(s)) · ${isRing ? 'reportable ring member' : 'not in a reportable ring'} · ${Number(node.in_degree || 0)} unique incoming / ${Number(node.out_degree || 0)} unique outgoing dependencies · ${Number(node.weighted_in_degree || 0)} incoming / ${Number(node.weighted_out_degree || 0)} outgoing events · PageRank ${Number(node.pagerank || 0).toFixed(5)}`));
      group.addEventListener('click', () => showProviderDetail(node.provider_id));
      group.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showProviderDetail(node.provider_id); }
      });
      group.addEventListener('mouseenter', () => highlightProvider(node.provider_id));
      group.addEventListener('mouseleave', clearHighlight);
      group.addEventListener('focus', () => highlightProvider(node.provider_id));
      group.addEventListener('blur', clearHighlight);
      nodeLayer.append(group);
    });

    function highlightProvider(providerId) {
      const relevantNodes = new Set([providerId]);
      edges.forEach((edge) => {
        if (edge.from_provider === providerId) relevantNodes.add(edge.to_provider);
        if (edge.to_provider === providerId) relevantNodes.add(edge.from_provider);
      });
      nodeLayer.querySelectorAll('.network-node').forEach((nodeEl) => {
        nodeEl.style.opacity = relevantNodes.has(nodeEl.getAttribute('data-provider-id')) ? '1' : '.28';
      });
      edgeLayer.querySelectorAll('.graph-edge').forEach((edgeEl) => {
        const relevant = edgeEl.getAttribute('data-from') === providerId || edgeEl.getAttribute('data-to') === providerId;
        edgeEl.style.opacity = relevant ? '1' : '.12';
      });
      labelLayer.querySelectorAll('.graph-edge-label').forEach((labelEl) => {
        const relevant = labelEl.getAttribute('data-from') === providerId || labelEl.getAttribute('data-to') === providerId;
        labelEl.style.opacity = relevant ? '1' : '.12';
      });
    }
    function clearHighlight() {
      nodeLayer.querySelectorAll('.network-node').forEach((nodeEl) => { nodeEl.style.opacity = ''; });
      edgeLayer.querySelectorAll('.graph-edge').forEach((edgeEl) => { edgeEl.style.opacity = ''; });
      labelLayer.querySelectorAll('.graph-edge-label').forEach((labelEl) => { labelEl.style.opacity = ''; });
    }

    let zoom = 1, panX = 0, panY = 0, drag = null;
    const applyTransform = () => viewport.setAttribute('transform', `translate(${panX} ${panY}) scale(${zoom})`);
    const zoomBy = (factor) => { zoom = Math.max(.6, Math.min(2.7, zoom * factor)); applyTransform(); };
    const controls = el('div', { className: 'graph-controls', role: 'group', attrs: { 'aria-label': 'Graph zoom and pan controls' } });
    controls.append(
      el('span', { className: 'graph-help' }, 'Arrow tips show referral direction · hover a provider to highlight its links · scroll to zoom · drag empty space to pan'),
      button('−', 'mini-button', () => zoomBy(.85), { attrs: { 'aria-label': 'Zoom out' } }),
      button('Reset view', 'mini-button', () => { zoom = 1; panX = 0; panY = 0; applyTransform(); clearHighlight(); }, { attrs: { 'aria-label': 'Reset graph zoom and pan' } }),
      button('+', 'mini-button', () => zoomBy(1.18), { attrs: { 'aria-label': 'Zoom in' } })
    );
    svg.addEventListener('wheel', (event) => { event.preventDefault(); zoomBy(event.deltaY < 0 ? 1.12 : .89); }, { passive: false });
    svg.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest?.('[role="button"]')) return;
      drag = { x: event.clientX, y: event.clientY, panX, panY };
      if (svg.setPointerCapture) svg.setPointerCapture(event.pointerId);
    });
    svg.addEventListener('pointermove', (event) => {
      if (!drag) return;
      const rect = svg.getBoundingClientRect();
      const unitX = width / Math.max(1, rect.width), unitY = height / Math.max(1, rect.height);
      panX = drag.panX + (event.clientX - drag.x) * unitX;
      panY = drag.panY + (event.clientY - drag.y) * unitY;
      applyTransform();
    });
    const stopPan = () => { drag = null; };
    svg.addEventListener('pointerup', stopPan);
    svg.addEventListener('pointercancel', stopPan);
    replace(host, [controls, svg]);
  }

  function renderCases() {
    const q = ($('#caseSearch')?.value || '').trim().toLowerCase(); const status = $('#caseStatusFilter')?.value || '';
    const rows = state.cases.filter((item) => (!status || item.status === status) && (!q || [item.case_id, item.provider_id, item.provider_name, item.title, item.status].some((value) => String(value || '').toLowerCase().includes(q))));
    const host = $('#caseList');
    if (!rows.length) return replace(host, [emptyState('No investigation cases found', 'Create a case to document review. Case status is independent of risk category.')]);
    replace(host, rows.map((item) => {
      const card = el('article', { className: 'case-card' }); const main = el('div');
      main.append(el('div', { className: 'case-title' }, item.title));
      const meta = el('div', { className: 'case-meta' }); meta.append(el('span', {}, item.case_id), el('span', {}, '·'), el('span', {}, `${item.provider_id} — ${item.provider_name || ''}`), el('span', {}, '·'), statusBadge(item.status), el('span', {}, '·'), el('span', {}, `Updated ${new Date(item.updated_at).toLocaleString()}`)); main.append(meta);
      const notes = el('details', { className: 'case-evidence' }); const summary = el('summary', {}, `Investigator notes (${item.notes?.length || 0})`); notes.append(summary);
      if (item.notes?.length) item.notes.forEach((note) => { const paragraph = el('p'); paragraph.append(el('strong', {}, `${note.created_by} · ${new Date(note.created_at).toLocaleString()}`), el('br'), document.createTextNode(note.body)); notes.append(paragraph); });
      main.append(notes);
      const actions = el('div', { className: 'case-actions' });
      const statusSelect = el('select', { 'aria-label': `Change status for ${item.case_id}` });
      state.meta.case_statuses.forEach((nextStatus) => statusSelect.append(el('option', { value: nextStatus, selected: nextStatus === item.status }, nextStatus)));
      statusSelect.addEventListener('change', () => updateCase(item, { status: statusSelect.value }));
      actions.append(statusSelect, button('Add note', 'mini-button', () => openForm('note', { case_id: item.case_id })), button('View provider', 'mini-button', () => showProviderDetail(item.provider_id)));
      if (!item.notes?.length) actions.append(button('Delete', 'mini-button danger', () => deleteCase(item)));
      card.append(main, actions); return card;
    }));
  }
  function renderAudit() {
    const tbody = $('#auditBody');
    replace(tbody, state.audit.slice(0, 20).map((event) => {
      const row = el('tr'); let detail = '—';
      try { const data = event.after_json ? JSON.parse(event.after_json) : event.before_json ? JSON.parse(event.before_json) : null; detail = data ? JSON.stringify(data).slice(0, 145) : '—'; } catch { /* malformed old audit entry is displayed as plain status */ }
      row.append(td(event.occurred_at ? new Date(event.occurred_at).toLocaleString() : '—'), td(event.entity_type), td(event.entity_id), td(event.operation), td(el('span', { className: 'audit-json', attrs: { title: detail } }, detail))); return row;
    }));
    if (!state.audit.length) replace(tbody, [emptyRow(5, 'No audit events yet.')]);
  }
  function providerOptions(selected = '', includeBlank = false, activeOnly = false) {
    const options = [];
    if (includeBlank) options.push({ value: '', label: 'None' });
    state.providers.filter((provider) => !activeOnly || provider.status !== 'INACTIVE').forEach((provider) => options.push({ value: provider.provider_id, label: `${provider.provider_id} — ${provider.provider_name}${provider.status === 'INACTIVE' ? ' (inactive)' : ''}` }));
    return options;
  }
  function addFormField(host, field, value) {
    const wrap = el('div', { className: `form-field ${field.full ? 'full' : ''}` });
    const inputId = `field-${field.name}`;
    if (field.type === 'multiselect') {
      const selectedValues = new Set((Array.isArray(value) ? value : value ? [value] : []).map(String));
      const group = el('fieldset', { id: inputId, className: 'multi-option-group', attrs: { 'aria-describedby': `${inputId}-help` } });
      group.append(el('legend', {}, field.label));
      const list = el('div', { className: 'multi-option-list', attrs: { role: 'group', 'aria-label': field.label } });
      (field.options || []).forEach((option, index) => {
        const optionId = `${inputId}-${index}`;
        const checkbox = el('input', { type: 'checkbox', id: optionId, name: field.name, value: option.value,
          checked: selectedValues.has(String(option.value)), disabled: Boolean(option.disabled) });
        const label = el('label', { className: 'multi-option', htmlFor: optionId });
        label.append(checkbox, el('span', {}, option.label));
        list.append(label);
      });
      group.append(list);
      wrap.append(group);
      if (field.help) wrap.append(el('span', { className: 'field-help', id: `${inputId}-help` }, field.help));
      host.append(wrap);
      return;
    }
    wrap.append(el('label', { htmlFor: inputId }, field.label));
    let control;
    if (field.type === 'select') {
      control = el('select', { id: inputId, name: field.name, required: Boolean(field.required), disabled: Boolean(field.disabled) });
      (field.options || []).forEach((option) => {
        const node = el('option', { value: option.value, selected: String(option.value) === String(value ?? '') }, option.label);
        if (option.disabled) node.disabled = true;
        control.append(node);
      });
    } else if (field.type === 'textarea') {
      control = el('textarea', { id: inputId, name: field.name, required: Boolean(field.required), rows: field.rows || 4, maxlength: field.maxlength || 5000, placeholder: field.placeholder || '' }); control.value = value ?? '';
    } else {
      control = el('input', { id: inputId, name: field.name, type: field.type || 'text', required: Boolean(field.required), disabled: Boolean(field.disabled), maxlength: field.maxlength || 120, placeholder: field.placeholder || '' });
      if (field.min !== undefined) control.min = String(field.min); if (field.max !== undefined) control.max = String(field.max); if (field.step) control.step = String(field.step);
      control.value = value ?? '';
    }
    if (field.readonly) control.readOnly = true;
    if (field.help) wrap.append(el('span', { className: 'field-help' }, field.help));
    wrap.append(control); host.append(wrap);
  }
  function openForm(kind, item = null) {
    const edit = Boolean(item && ((kind === 'provider' && item.provider_id) || (kind === 'claim' && item.claim_id) || (kind === 'referral' && item.referral_id) || (kind === 'case' && item.case_id))); 
    if (kind === 'claim' && edit && !state.referralsAvailable) {
      notify('Referral events could not be loaded. Refresh the dashboard before editing this claim so existing recipients are not accidentally removed.', 'error');
      return;
    }
    state.form = { kind, edit, item, id: item?.provider_id || item?.claim_id || item?.referral_id || item?.case_id || null };
    const fields = $('#formFields'); replace(fields, []);
    $('#formError').classList.add('hidden');
    const config = {
      provider: { title: edit ? 'Edit provider' : 'Add provider', desc: 'Provider information is validated by the API and saved to SQLite.', fields: [
        { name: 'provider_id', label: 'Provider ID', required: true, disabled: edit, maxlength: 32, placeholder: 'e.g. P031', help: edit ? 'Provider IDs cannot be changed.' : 'Unique ID using letters, digits, underscore or hyphen.' },
        { name: 'provider_name', label: 'Provider name', required: true, maxlength: 120 },
        { name: 'specialty', label: 'Specialty', required: true, type: 'select', options: state.meta.specialties.map((s) => ({ value: s, label: s })) },
        { name: 'city', label: 'City', required: true, maxlength: 100 },
        ...(edit ? [{ name: 'status', label: 'Status', required: true, type: 'select', options: [{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }] }] : []),
      ] },
      claim: { title: edit ? 'Edit claim' : 'Create claim', desc: edit ? 'Edit the claim and manage its linked referral recipients. Selected recipients replace only the referral events linked to this claim; standalone/manual referral events are untouched.' : 'Amount is billed, not a confirmed insurer payment. Select multiple referral recipients to create linked referral events in the same transaction. Only synthetic patient IDs are allowed.', fields: [
        { name: 'claim_id', label: 'Claim ID', required: true, disabled: edit, maxlength: 40, placeholder: 'e.g. C01201' },
        { name: 'provider_id', label: 'Provider / referring source', required: true, type: 'select', options: providerOptions() },
        { name: 'patient_id', label: 'Synthetic patient ID', required: true, maxlength: 80, placeholder: 'PAT9001', help: 'Must start with PAT, SYN or DEMO.' },
        { name: 'procedure_code', label: 'Procedure code', required: true, maxlength: 80, placeholder: 'PROC-001' },
        { name: 'claim_amount', label: 'Amount billed (₹)', required: true, type: 'number', min: 0, max: 1000000000, step: '0.01' },
        { name: 'claim_date', label: 'Claim date', required: true, type: 'date' },
        { name: 'specialty', label: 'Specialty on claim', required: true, type: 'select', options: state.meta.specialties.map((s) => ({ value: s, label: s })) },
        { name: 'referral_targets', label: edit ? 'Linked referral recipients (optional; select multiple)' : 'Referral recipients (optional; select multiple)', type: 'multiselect', full: true, size: 6, options: providerOptions('', false, !edit), help: edit ? 'Checked providers are the recipients currently linked to this claim. Add or uncheck recipients, then save: additions and removals are applied atomically. Standalone referrals are not changed. Inactive existing recipients can be removed, but new referrals to inactive providers are not allowed.' : 'Check one or more active providers. One referral event is created per selected provider in the same transaction as this claim. The graph displays each provider-pair dependency once and retains event counts.' },
      ] },
      referral: { title: edit ? 'Edit referral event' : 'Add referral event', desc: 'Repeated source/destination pairs are allowed and preserved as separate events.', fields: [
        { name: 'referral_id', label: 'Referral event ID', required: true, disabled: edit, maxlength: 40, placeholder: 'e.g. R0081' },
        { name: 'from_provider', label: 'From provider', required: true, type: 'select', options: providerOptions() },
        { name: 'to_provider', label: 'To provider', required: true, type: 'select', options: providerOptions() },
        { name: 'reason', label: 'Reason', required: true, maxlength: 160, placeholder: 'specialist_referral' },
        { name: 'event_date', label: 'Event date (optional)', type: 'date', help: 'Leave blank if the source data did not record a date.' },
      ] },
      case: { title: edit ? 'Edit investigation' : 'Open investigation', desc: 'Workflow status is independent of the computed provider risk score.', fields: [
        { name: 'provider_id', label: 'Provider', required: true, type: 'select', options: providerOptions() },
        { name: 'title', label: 'Case title', required: true, maxlength: 180, placeholder: 'Review unusual billed-amount pattern' },
        { name: 'status', label: 'Workflow status', required: true, type: 'select', options: state.meta.case_statuses.map((s) => ({ value: s, label: s })) },
      ] },
      note: { title: 'Add investigator note', desc: 'Keep notes factual and avoid real patient or sensitive personal information.', fields: [
        { name: 'body', label: 'Note', required: true, type: 'textarea', maxlength: 5000, full: true, placeholder: 'Record observations, validation steps and next actions…' },
        { name: 'created_by', label: 'Investigator label', required: true, maxlength: 100, placeholder: 'Local investigator' },
      ] },
    };
    const choice = config[kind]; if (!choice) return;
    $('#formTitle').textContent = choice.title; $('#formDescription').textContent = choice.desc;
    $('#formEyebrow').textContent = kind === 'case' || kind === 'note' ? 'CASE MANAGEMENT' : 'RECORD MANAGEMENT';
    choice.fields.forEach((field) => {
      let currentValue = item?.[field.name];
      if (kind === 'provider' && field.name === 'status') currentValue ||= 'ACTIVE';
      if (kind === 'claim' && field.name === 'specialty') currentValue ||= state.providers.find((p) => p.provider_id === item?.provider_id)?.specialty || state.meta.specialties[0];
      if (kind === 'claim' && field.name === 'claim_date') currentValue ||= new Date().toISOString().slice(0, 10);
      if (kind === 'claim' && field.name === 'patient_id' && !edit) currentValue = 'PAT';
      if (kind === 'claim' && field.name === 'referral_targets') currentValue = edit
        ? [...new Set(state.referrals.filter((referral) => referral.source_claim_id === item?.claim_id).map((referral) => referral.to_provider))]
        : [];
      if (kind === 'referral' && field.name === 'reason') currentValue ||= 'specialist_referral';
      if (kind === 'case' && field.name === 'status') currentValue ||= 'PENDING REVIEW';
      if (kind === 'note' && field.name === 'created_by') currentValue ||= 'Local investigator';
      addFormField(fields, field, currentValue);
    });
    if (kind === 'claim') {
      const source = $('#field-provider_id'); const targets = $('#field-referral_targets');
      if (source && targets) {
        const initialRecipients = new Set(edit
          ? state.referrals.filter((referral) => referral.source_claim_id === item?.claim_id).map((referral) => referral.to_provider)
          : []);
        const syncRecipients = () => $$('input[type="checkbox"][name="referral_targets"]', targets).forEach((option) => {
          const isSelf = Boolean(option.value) && option.value === source.value;
          const provider = state.providers.find((candidate) => candidate.provider_id === option.value);
          const inactiveAndNotExisting = provider?.status === 'INACTIVE' && !initialRecipients.has(option.value);
          if (isSelf) option.checked = false;
          option.disabled = isSelf || inactiveAndNotExisting;
          option.closest('label')?.classList.toggle('is-disabled', option.disabled);
        });
        source.addEventListener('change', syncRecipients); syncRecipients();
      }
    }
    $('#saveFormButton').textContent = kind === 'note' ? 'Save note' : edit ? 'Save changes' : 'Create record';
    $('#formDialog').showModal();
  }
  async function saveForm(event) {
    event.preventDefault();
    const form = $('#recordForm'); const context = state.form; if (!context) return;
    if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form).entries());
    if (context.kind === 'claim') data.referral_targets = $$('input[type="checkbox"][name="referral_targets"]:checked', form).map((option) => option.value);
    const buttonNode = $('#saveFormButton'); buttonNode.disabled = true; buttonNode.textContent = 'Saving…';
    try {
      const { kind, edit, item } = context; let url = '', method = edit ? 'PATCH' : 'POST';
      if (kind === 'provider') url = edit ? `/api/providers/${encodeURIComponent(item.provider_id)}` : '/api/providers';
      if (kind === 'claim') url = edit ? `/api/claims/${encodeURIComponent(item.claim_id)}` : '/api/claims';
      if (kind === 'referral') url = edit ? `/api/referrals/${encodeURIComponent(item.referral_id)}` : '/api/referrals';
      if (kind === 'case') url = edit ? `/api/investigations/${encodeURIComponent(item.case_id)}` : '/api/investigations';
      if (kind === 'note') { url = `/api/investigations/${encodeURIComponent(item.case_id)}/notes`; method = 'POST'; }
      Object.keys(data).forEach((key) => { if (data[key] === '') delete data[key]; });
      const saved = await api(url, { method, body: JSON.stringify(data) });
      $('#formDialog').close(); state.form = null;
      await loadAll(false); notify(`${kind === 'note' ? 'Investigator note' : kind[0].toUpperCase() + kind.slice(1)} ${edit ? 'updated' : 'saved'} successfully.`);
      if (kind === 'claim' && edit && Array.isArray(saved.linked_referrals)) {
        const added = saved.created_referrals?.length || 0;
        const removed = saved.removed_referral_ids?.length || 0;
        notify(`Claim updated. Referral recipients synchronized (${added} added, ${removed} removed).`);
      }
      if (kind === 'provider' && !edit) { showView('providers'); }
      if (kind === 'case' || kind === 'note') showView('investigations');
    } catch (error) {
      $('#formError').textContent = error.message || 'The record could not be saved.'; $('#formError').classList.remove('hidden');
    } finally { buttonNode.disabled = false; buttonNode.textContent = context.kind === 'note' ? 'Save note' : context.edit ? 'Save changes' : 'Create record'; }
  }
  async function toggleProviderStatus(provider) {
    const next = provider.status === 'INACTIVE' ? 'ACTIVE' : 'INACTIVE';
    if (next === 'INACTIVE' && !window.confirm(`Deactivate ${provider.provider_id}? Historical claims, referrals and cases will be preserved.`)) return;
    try { await api(`/api/providers/${encodeURIComponent(provider.provider_id)}`, { method: 'PATCH', body: JSON.stringify({ status: next }) }); await loadAll(); notify(`${provider.provider_id} is now ${next.toLowerCase()}.`); }
    catch (error) { notify(error.message, 'error'); }
  }
  async function deleteProvider(provider) {
    if (!window.confirm(`Permanently delete ${provider.provider_id}? This also deletes claims associated with the provider (as billing or referred-to provider) and referral events involving the provider or linked to those claims. Investigation cases and notes are preserved, so providers with investigation cases cannot be permanently deleted; deactivate them instead. This action cannot be undone.`)) return;
    try {
      const result = await api(`/api/providers/${encodeURIComponent(provider.provider_id)}`, { method: 'DELETE' });
      await loadAll();
      notify(`Provider deleted. Removed ${result.deleted_claims ?? 0} associated claim(s) and ${result.deleted_referrals ?? 0} referral event(s).`);
    }
    catch (error) { notify(error.message, 'error'); }
  }
  async function deleteClaim(claim) {
    if (!window.confirm(`Delete claim ${claim.claim_id}? This will recalculate all current analytics and save a new snapshot.`)) return;
    try { await api(`/api/claims/${encodeURIComponent(claim.claim_id)}`, { method: 'DELETE' }); await loadAll(); notify('Claim deleted and analytics recalculated.'); }
    catch (error) { notify(error.message, 'error'); }
  }
  async function deleteReferral(referral) {
    if (!window.confirm(`Delete referral event ${referral.referral_id}? If it completes a cycle, the new graph and SCC results will update.`)) return;
    try { await api(`/api/referrals/${encodeURIComponent(referral.referral_id)}`, { method: 'DELETE' }); await loadAll(); notify('Referral event deleted and graph recalculated.'); }
    catch (error) { notify(error.message, 'error'); }
  }
  async function updateCase(item, patch) {
    try { await api(`/api/investigations/${encodeURIComponent(item.case_id)}`, { method: 'PATCH', body: JSON.stringify(patch) }); await loadAll(); notify('Investigation workflow updated; provider risk score is unchanged.'); }
    catch (error) { notify(error.message, 'error'); await loadAll(); }
  }
  async function deleteCase(item) {
    if (!window.confirm(`Delete case ${item.case_id}? Cases with notes are retained for historical integrity.`)) return;
    try { await api(`/api/investigations/${encodeURIComponent(item.case_id)}`, { method: 'DELETE' }); await loadAll(); notify('Investigation deleted.'); }
    catch (error) { notify(error.message, 'error'); }
  }
  async function showProviderDetail(id) {
    try {
      const provider = await api(`/api/providers/${encodeURIComponent(id)}`);
      $('#detailTitle').textContent = `${provider.provider_id} · ${provider.provider_name}`;
      $('#detailSubtitle').textContent = `${provider.specialty} · ${provider.city} · ${provider.status} · Model ${state.summary?.model_version || '—'} · UI 2.3.13`;
      const host = $('#detailContent'); const pieces = [];
      const metrics = el('div', { className: 'detail-metrics' });
      metrics.append(metricCell('Risk score', score(provider.risk_score)), metricCell('Risk category', provider.risk_level), metricCell('Claims', number(provider.claim_count)), metricCell('Total billed', money(provider.total_billed_amount)));
      pieces.push(metrics);
      const components = el('div', { className: 'component-list' });
      [
        ['Billing amount', 'statistical', 40, provider.statistical_risk],
        ['Referral ring', 'referral_ring', 30, provider.referral_ring_risk],
        ['Network', 'network', 20, provider.network_risk],
        ['Behavior', 'behavior', 10, provider.behaviour_risk],
      ].forEach(([label, key, baseWeight, value]) => {
        const card = el('div', { className: 'component-score' });
        const effective = provider.effective_component_weights?.[key];
        card.append(el('span', {}, `${label} · ${baseWeight}% base`));
        card.append(el('small', { className: 'effective-weight' }, effective === null || effective === undefined ? 'Excluded · insufficient evidence' : `Effective ${Number(effective * 100).toFixed(1)}%`));
        card.append(el('strong', {}, value === null || value === undefined ? 'Not evaluable' : score(value)));
        const contribution = value === null || value === undefined || effective === null || effective === undefined
          ? 'Not included in composite'
          : `Adds ${score(Number(value) * Number(effective))} points to final score`;
        card.append(el('small', { className: 'score-contribution' }, contribution));
        components.append(card);
      });
      pieces.push(components);
      const formula = el('p', { className: 'subtle' }, `Composite score = sum of each available component × its effective weight. Each card shows its contribution in score points. The effective weights shown above are renormalized to 100%; missing evidence is omitted, not treated as a zero score. Billing-amount risk uses a peer-median amount ratio; the diagnostic Z-score is not directly scored. The behavior score combines available recent 30-day peer activity (50%), own current-vs-prior 30-day trend (30%), and 7-day-vs-prior-23-day rate burst (20%); it requires at least two evaluable signals, with their internal weights renormalized. Total billed amount is contextual and is not a separate score input. Overall totals can include claims from historical specialties, while amount and behavior components use current-specialty claims. Overall risk can differ from total-billed ranking when referral-ring and network evidence differ.`);
      pieces.push(formula);
      const explain = el('section', { className: 'detail-section' }); explain.append(el('h3', {}, 'Evidence and calculation explanations'));
      const list = el('ul'); (provider.explanation || []).forEach((reason) => list.append(el('li', {}, reason))); explain.append(list, el('p', { className: 'subtle' }, `Calculated ${new Date(state.summary?.calculated_at || Date.now()).toLocaleString()} · Data version ${state.summary?.data_version ?? '—'} · ${provider.score_methodology || 'Heuristic risk score'}`)); pieces.push(explain);
      const details = el('div', { className: 'detail-columns' });
      const stat = el('section', { className: 'detail-section' }); stat.append(el('h3', {}, 'Statistical and activity details'));
      const ul = el('ul'); [
        `Mean billed amount (claims tagged to current specialty): ${money(provider.average_claim_amount)} across ${number(provider.specialty_claim_count)} claim(s)`,
        `Overall average across all claims: ${money(provider.overall_average_claim_amount)}`,
        `Same-specialty peer median of provider means: ${money(provider.peer_median_average_claim_amount)}`,
        `Per-claim amount ratio vs peer median: ${provider.average_claim_amount_ratio == null ? 'Not evaluable' : `${Number(provider.average_claim_amount_ratio).toFixed(2)}×`}`,
        `Billing-amount risk score: ${provider.statistical_risk == null ? 'Not evaluable' : score(provider.statistical_risk)}`,
        `Specialty total billed: ${money(provider.specialty_total_billed_amount)}; peer median exposure: ${money(provider.peer_median_specialty_total_billed_amount)} (context only, not independently added to score)`,
        `Distinct peer providers: ${number(provider.peer_provider_count)}`,
        `Amount Z-score: ${provider.specialty_z_score == null ? 'Not available' : Number(provider.specialty_z_score).toFixed(3)}`,
        `Reference status: ${provider.statistical_status || 'Not available'}`,
        `7-day claims / billed: ${number(provider.claims_7d)} / ${money(provider.billed_7d)} · ${provider.window_7d_complete ? 'dataset date span covers this window' : 'dataset date span is shorter than this window'}`,
        `30-day claims / billed: ${number(provider.claims_30d)} / ${money(provider.billed_30d)} · ${provider.window_30d_complete ? 'dataset date span covers this window' : 'dataset date span is shorter than this window'}`,
        `Previous 30-day claims: ${number(provider.previous_claims_30d)} · ${provider.previous_30d_complete ? 'dataset date span covers both periods' : 'dataset date span is shorter than both periods; percentage change withheld'}`,
        `Matching-specialty claims: last 7d / last 30d / prior 30d / prior 23d: ${number(provider.specialty_claims_7d)} / ${number(provider.specialty_claims_30d)} / ${number(provider.specialty_previous_claims_30d)} / ${number(provider.specialty_claims_prior23d)}`,
        `Behavior 30-day peer ratio: ${provider.peer_recent_claim_ratio == null ? 'Not evaluable' : `${Number(provider.peer_recent_claim_ratio).toFixed(2)}×`} · own 30-day trend ratio: ${provider.own_30d_trend_ratio == null ? 'Not evaluable' : `${Number(provider.own_30d_trend_ratio).toFixed(2)}×`}`,
        `Behavior 7-day burst ratio: ${provider.short_window_burst_ratio == null ? 'Not evaluable' : `${Number(provider.short_window_burst_ratio).toFixed(2)}×`} · status: ${provider.behavior_status || 'Not available'} (${number(provider.behavior_available_signal_count)}/3 signals)` ,
        `Observation window: ${provider.observation_start || '—'} to ${provider.observation_end || '—'} (${number(provider.observation_days)} days)`,
      ].forEach((line) => ul.append(el('li', {}, line))); stat.append(ul); details.append(stat);
      const graphInfo = el('section', { className: 'detail-section' }); graphInfo.append(el('h3', {}, 'Referral network evidence'));
      const gu = el('ul'); [
        `SCC membership: ${provider.scc_id ? `#${provider.scc_id} (${provider.scc_size} providers)` : 'Not assigned'}`,
        `Unique in / out degree: ${number(provider.in_degree)} / ${number(provider.out_degree)}`,
        `Weighted in / out events: ${number(provider.weighted_in_degree)} / ${number(provider.weighted_out_degree)}`,
        `PageRank: ${Number(provider.pagerank || 0).toFixed(6)}`,
        ...(provider.ring_detected ? [`Cycle: ${(state.analytics?.rings || []).find((ring) => ring.scc_id === provider.scc_id)?.cycle_path?.join(' → ') || 'See component edges'}`] : []),
      ].forEach((line) => gu.append(el('li', {}, line))); graphInfo.append(gu); details.append(graphInfo); pieces.push(details);
      const claimSection = el('section', { className: 'detail-section' }); claimSection.append(el('h3', {}, `Recent claims (${provider.claims?.length || 0})`));
      if (provider.claims?.length) {
        const table = el('table'); const thead = el('thead'); const hr = el('tr'); ['Claim ID', 'Date', 'Procedure', 'Billed', 'Claim specialty'].forEach((title) => hr.append(el('th', {}, title))); thead.append(hr); const tbody = el('tbody');
        provider.claims.slice(0, 8).forEach((claim) => { const tr = el('tr'); [claim.claim_id, claim.claim_date, claim.procedure_code, money(claim.claim_amount), claim.specialty].forEach((value) => tr.append(td(value))); tbody.append(tr); }); table.append(thead, tbody); claimSection.append(table);
      } else claimSection.append(el('p', {}, 'No claims are linked to this provider. Claim-based indicators are not evaluable.'));
      pieces.push(claimSection);
      const refSection = el('section', { className: 'detail-section' }); refSection.append(el('h3', {}, `Referral events (${provider.referrals?.length || 0})`));
      if (provider.referrals?.length) { const listRefs = el('ul'); provider.referrals.slice(0, 15).forEach((ref) => listRefs.append(el('li', {}, `${ref.referral_id}: ${ref.from_provider} → ${ref.to_provider} · ${ref.reason}${ref.event_date ? ` · ${ref.event_date}` : ''}${ref.source_claim_id ? ` · claim ${ref.source_claim_id}` : ''}`))); refSection.append(listRefs); }
      else refSection.append(el('p', {}, 'No referral event records are linked to this provider.'));
      pieces.push(refSection);
      const caseSection = el('section', { className: 'detail-section' }); caseSection.append(el('h3', {}, `Investigation history (${provider.investigations?.length || 0})`));
      if (provider.investigations?.length) provider.investigations.forEach((item) => caseSection.append(el('p', {}, `${item.case_id} · ${item.title} · ${item.status} · ${item.notes?.length || 0} note(s)`)));
      else caseSection.append(el('p', {}, 'No investigation cases recorded for this provider.'));
      caseSection.append(button('＋ Open investigation', 'button button-quiet', () => { $('#detailDialog').close(); openForm('case', { provider_id: provider.provider_id }); })); pieces.push(caseSection);
      replace(host, pieces);
      $('#printDetailButton').onclick = () => { window.open(`/api/reports/provider/${encodeURIComponent(id)}/print`, '_blank', 'noopener'); };
      $('#detailDialog').showModal();
    } catch (error) { notify(error.message, 'error'); }
  }
  function bindEvents() {
    $$('.nav-item').forEach((item) => item.addEventListener('click', () => showView(item.dataset.view)));
    $$('[data-go]').forEach((item) => item.addEventListener('click', () => showView(item.dataset.go)));
    $('#refreshButton').addEventListener('click', () => loadAll(true));
    $('#addProviderButton').addEventListener('click', () => openForm('provider'));
    $('#addClaimButton').addEventListener('click', () => openForm('claim'));
    $('#addReferralButton').addEventListener('click', () => openForm('referral'));
    $('#addCaseButton').addEventListener('click', () => openForm('case'));
    $('#closeFormButton').addEventListener('click', () => $('#formDialog').close());
    $('#cancelFormButton').addEventListener('click', () => $('#formDialog').close());
    $('#recordForm').addEventListener('submit', saveForm);
    ['closeDetailButton', 'closeDetailButton2'].forEach((id) => $(`#${id}`).addEventListener('click', () => $('#detailDialog').close()));
    $('#providerSearch').addEventListener('input', () => { state.providerPage = 1; renderProviderDirectory(); });
    $('#providerRiskFilter').addEventListener('change', () => { state.providerPage = 1; renderProviderDirectory(); });
    $('#providerStatusFilter').addEventListener('change', () => { state.providerPage = 1; renderProviderDirectory(); });
    $('#claimSearch').addEventListener('input', () => { state.claimPage = 1; renderClaims(); });
    $('#claimSpecialtyFilter').addEventListener('change', () => { state.claimPage = 1; renderClaims(); });
    $('#referralSearch').addEventListener('input', () => { state.referralPage = 1; renderReferrals(); });
    $('#caseSearch').addEventListener('input', renderCases);
    $('#caseStatusFilter').addEventListener('change', renderCases);
    $$('[data-sort-provider]').forEach((buttonNode) => buttonNode.addEventListener('click', () => {
      const key = buttonNode.dataset.sortProvider;
      state.providerDirection = state.providerSort === key && state.providerDirection === 'asc' ? 'desc' : 'asc'; state.providerSort = key; state.providerPage = 1; renderProviderDirectory();
    }));
    $$('[data-export]').forEach((buttonNode) => buttonNode.addEventListener('click', () => { window.location.assign(`/api/export/${buttonNode.dataset.export}.csv`); }));
  }

  bindEvents();
  loadAll().catch((error) => { alertMessage(`The dashboard could not load: ${error.message || 'backend unavailable'}. Start the server and refresh.`, true); });
})();

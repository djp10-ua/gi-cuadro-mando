/* ── DASHBOARD CORE ── */
const API = '';
let chartInstances = {};
let benchData = null;

// ── Clock ──
function startClock() {
  const el = document.getElementById('topbar-clock');
  const tick = () => { el.textContent = new Date().toLocaleTimeString('es-ES'); };
  tick(); setInterval(tick, 1000);
}

// ── Navigation ──
const SECTIONS = [
  { id: 'overview',    label: 'Resumen General',   badge: 'OVERVIEW' },
  { id: 'storage',     label: 'Almacenamiento',     badge: 'STORAGE' },
  { id: 'music',       label: 'Análisis Musical',   badge: 'MUSIC' },
  { id: 'users',       label: 'Usuarios',           badge: 'USERS' },
  { id: 'performance', label: 'Rendimiento DB',      badge: 'PERFORMANCE' },
];

function activateSection(id) {
  document.querySelectorAll('.dashboard-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const sec = document.getElementById(id);
  if (sec) sec.classList.add('active');
  const nav = document.getElementById('nav-' + id);
  if (nav) nav.classList.add('active');
  const info = SECTIONS.find(s => s.id === id);
  if (info) {
    document.getElementById('section-title').textContent = info.label;
    document.getElementById('section-badge').textContent = info.badge;
  }
}

// ── Fetch helper ──
async function fetchJSON(path) {
  const r = await fetch(API + path);
  if (!r.ok) {
    let msg = r.statusText;
    try {
      const body = await r.json();
      if (body && body.error) msg = body.error;
    } catch (_) {}
    throw new Error(msg || 'Request failed');
  }
  return r.json();
}

// ── Format helpers ──
function fmt(n) {
  if (n === undefined || n === null) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}
function fmtBytes(b) {
  if (!b) return '—';
  if (b >= 1e9) return (b / 1e9).toFixed(2) + ' GB';
  if (b >= 1e6) return (b / 1e6).toFixed(2) + ' MB';
  if (b >= 1e3) return (b / 1e3).toFixed(1) + ' KB';
  return b + ' B';
}
function fmtPct(p) {
  if (p === null || p === undefined || Number.isNaN(Number(p))) return '—';
  return `${Number(p).toFixed(1)}%`;
}
function setVal(id, v) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = v;
  el.classList.remove('counting');
  void el.offsetWidth;
  el.classList.add('counting');
}

// ── Status pill ──
function setStatus(ok, text) {
  const pill = document.getElementById('global-status');
  const txt  = document.getElementById('status-text');
  txt.textContent = text;
  pill.style.background = ok ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)';
  pill.style.borderColor = ok ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)';
  pill.style.color = ok ? 'var(--green-l)' : 'var(--red-l)';
}

// ── Load COUNTS ──
async function loadCounts() {
  const d = await fetchJSON('/api/counts');
  setVal('kv-tracks',    fmt(d.spotify_tracks));
  setVal('kv-users',     fmt(d.lista_usuarios));
  setVal('kv-addresses', fmt(d.lista_direcciones));
  setVal('kv-favs',      fmt(d.favoritas));
  setVal('kv-users2',    fmt(d.lista_usuarios));
  setVal('kv-favs2',     fmt(d.favoritas));
  const avg = d.lista_usuarios > 0 ? (d.favoritas / d.lista_usuarios).toFixed(1) : '—';
  setVal('kv-avg-favs', avg);
  return d;
}

// ── Load SYSTEM ──
async function loadSystem() {
  const d = await fetchJSON('/api/system');
  const k = d.kpis || {};
  setVal('kv-mem-total', `${fmtBytes(d.os.totalMem)} · ref ${fmtBytes(k.ramTotal?.reference)}`);
  setVal('kv-mem-free',  `${fmtBytes(d.os.freeMem)} · ref ${fmtBytes(k.ramFree?.reference)}`);
  setVal('kv-cpus',      `${d.os.cpus} cores · ref ${k.cpuCores?.reference ?? d.os.cpus}`);
  setVal('kv-disk-free', `${fmtBytes(d.host?.diskFreeBytes)} · ref ${fmtBytes(k.diskFree?.reference)}`);
  const pct = Math.round((1 - d.os.freeMem / d.os.totalMem) * 100);
  setVal('gauge-mem-label', pct + '%');
  return { pct, os: d.os };
}

// ── Load STORAGE ──
async function loadStorage() {
  const d = await fetchJSON('/api/storage');
  const dbKpi = d.kpis?.dbTotalBytes;
  setVal('kv-dbsize', `${d.dbSize.total_size_readable || fmtBytes(d.dbSize.total_size_bytes)} · ref ${fmtBytes(dbKpi?.reference)}`);

  const tbody = document.getElementById('storage-tbody');
  if (!tbody) return d;
  tbody.innerHTML = '';
  (d.tables || []).forEach(t => {
    const rows = Number(t.total_rows);
    const status = rows > 0 ? '<span class="badge badge-ok">Activa</span>' : '<span class="badge badge-warn">Vacía</span>';
    tbody.innerHTML += `<tr>
      <td><strong>${t.table}</strong></td>
      <td>${t.size_readable}</td>
      <td>${fmt(rows)}</td>
      <td>${t.parts}</td>
      <td>${status}</td>
    </tr>`;
  });
  return d;
}

// ── Load TOP TRACKS table ──
async function loadTopTracksTable() {
  const tracks = await fetchJSON('/api/top-tracks');
  const tbody = document.getElementById('top-tracks-tbody');
  if (!tbody) return tracks;
  tbody.innerHTML = '';
  tracks.forEach((t, i) => {
    tbody.innerHTML += `<tr>
      <td><strong>#${i + 1}</strong></td>
      <td>${t.track}</td>
      <td>${t.artist}</td>
      <td>${t.genre}</td>
      <td>${t.year}</td>
      <td>
        <div class="pop-bar-wrap">
          <div class="pop-bar-bg"><div class="pop-bar-fill" style="width:${t.popularity}%"></div></div>
          <span class="pop-num">${t.popularity}</span>
        </div>
      </td>
    </tr>`;
  });
  return tracks;
}

// ── Load BENCHMARK ──
async function loadBenchmark() {
  const d = await fetchJSON('/api/benchmark');
  benchData = d;
  setVal('kv-mean', d.mean + ' ms');
  setVal('kv-std',  d.std  + ' ms');
  setVal('kv-ci',   '±' + d.eps + ' ms');
  setVal('kv-bench-status', d.status);

  const kpiCard = document.getElementById('kpi-bench-status');
  if (kpiCard) {
    kpiCard.className = 'kpi-card ' + (d.status === 'OK' ? 'gradient-green' : d.status === 'WARNING' ? 'gradient-orange' : 'gradient-blue');
    kpiCard.querySelector('.kpi-icon').textContent = d.status === 'OK' ? '✅' : d.status === 'WARNING' ? '⚠️' : '🔴';
  }

  setVal('sv-n',      String(d.n || d.runs?.length || 0));
  setVal('sv-mean',   d.mean + ' ms');
  setVal('sv-std',    d.std  + ' ms');
  setVal('sv-eps',    d.eps  + ' ms');
  setVal('sv-result', `${d.ci_low} – ${d.ci_high} ms`);
  const delta = d.kpi?.latencyMs?.delta;
  const deltaPct = d.kpi?.latencyMs?.deltaPct;
  const deltaTxt = delta === undefined ? '' : ` (Δ ${Number(delta).toFixed(2)} ms, ${fmtPct(deltaPct)})`;
  setVal('sv-baseline', d.baseline + ' ms' + deltaTxt);
  const queryEl = document.getElementById('bench-query-code');
  if (queryEl && d.query) queryEl.textContent = d.query;

  const perfPct = Math.min(200, Math.round((d.mean / d.baseline) * 100));
  setVal('gauge-perf-label', perfPct + '%');
  return d;
}

// ── Load provinces KPI ──
async function loadProvinceKPI(data) {
  setVal('kv-provinces', data.length);
}

// ── Last update ──
function setLastUpdate() {
  const el = document.getElementById('last-update-time');
  if (el) el.textContent = new Date().toLocaleTimeString('es-ES');
}

// ── INIT ──
window.dashboardCoreReady = { loadCounts, loadSystem, loadStorage, loadTopTracksTable, loadBenchmark, loadProvinceKPI, setStatus, setLastUpdate, activateSection, fetchJSON };

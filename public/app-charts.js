/* ── CHART HELPERS ── */
const PALETTE = ['#3b82f6','#8b5cf6','#10b981','#f59e0b','#06b6d4','#ec4899','#f97316','#14b8a6','#a855f7','#22d3ee','#84cc16','#ef4444','#6366f1','#0ea5e9','#d946ef'];

function destroyChart(id) {
  if (window.chartInstances && window.chartInstances[id]) {
    window.chartInstances[id].destroy();
    delete window.chartInstances[id];
  }
}
function saveChart(id, chart) {
  if (!window.chartInstances) window.chartInstances = {};
  window.chartInstances[id] = chart;
}

const BASE_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { labels: { color: '#8b9cc8', font: { family: 'Inter', size: 12 }, boxWidth: 12 } }, tooltip: { backgroundColor: '#111827', borderColor: 'rgba(255,255,255,0.08)', borderWidth: 1, titleColor: '#f0f4ff', bodyColor: '#8b9cc8', padding: 12, cornerRadius: 8 } },
  scales: {
    x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#4a5578', font: { family: 'Inter', size: 11 } } },
    y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#4a5578', font: { family: 'Inter', size: 11 } } },
  },
};

function mkChart(id, config) {
  destroyChart(id);
  const canvas = document.getElementById(id);
  if (!canvas) return null;
  const c = new Chart(canvas, config);
  saveChart(id, c);
  return c;
}

// ── Sparkline ──
function mkSparkline(id, color) {
  const data = Array.from({length:12}, () => Math.random());
  mkChart(id, {
    type: 'line',
    data: { labels: data.map((_,i)=>i), datasets: [{ data, borderColor: color, borderWidth: 1.5, fill: true, backgroundColor: color + '22', tension: 0.4, pointRadius: 0 }] },
    options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false},tooltip:{enabled:false}}, scales:{x:{display:false},y:{display:false}} },
  });
}

// ── Genres bar chart ──
async function renderGenres() {
  const data = await window.dashboardCoreReady.fetchJSON('/api/genres');
  mkChart('chart-genres', {
    type: 'bar',
    data: {
      labels: data.map(d => d.genre),
      datasets: [{ label: 'Canciones', data: data.map(d => d.count), backgroundColor: data.map((_,i) => PALETTE[i % PALETTE.length] + 'cc'), borderColor: data.map((_,i) => PALETTE[i % PALETTE.length]), borderWidth: 1, borderRadius: 6 }],
    },
    options: { ...BASE_OPTS, indexAxis: 'y', plugins: { ...BASE_OPTS.plugins, legend: { display: false }, datalabels: { display: false } } },
  });
}

// ── Popularity histogram ──
async function renderPopularity() {
  const data = await window.dashboardCoreReady.fetchJSON('/api/popularity');
  mkChart('chart-popularity', {
    type: 'bar',
    data: {
      labels: data.map(d => d.bucket + '-' + (d.bucket + 9)),
      datasets: [{ label: 'Tracks', data: data.map(d => d.count), backgroundColor: PALETTE.map(c => c + 'bb'), borderRadius: 5 }],
    },
    options: { ...BASE_OPTS, plugins: { ...BASE_OPTS.plugins, legend: { display: false } } },
  });
}

// ── Top tracks bar ──
async function renderTopTracksChart() {
  const data = await window.dashboardCoreReady.fetchJSON('/api/top-tracks');
  mkChart('chart-top-tracks', {
    type: 'bar',
    data: {
      labels: data.map(d => d.track.length > 20 ? d.track.substring(0,20)+'…' : d.track),
      datasets: [{ label: 'Popularidad', data: data.map(d => d.popularity), backgroundColor: PALETTE.map(c => c + 'cc'), borderRadius: 6 }],
    },
    options: { ...BASE_OPTS, indexAxis: 'y', plugins: { ...BASE_OPTS.plugins, legend: { display: false } } },
  });
}

// ── Tracks by year ──
async function renderTracksYear() {
  const data = await window.dashboardCoreReady.fetchJSON('/api/tracks-by-year');
  mkChart('chart-year', {
    type: 'line',
    data: {
      labels: data.map(d => d.year),
      datasets: [{ label: 'Canciones', data: data.map(d => d.count), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)', fill: true, tension: 0.4, pointRadius: 2, pointHoverRadius: 5 }],
    },
    options: { ...BASE_OPTS, plugins: { ...BASE_OPTS.plugins, legend: { display: false } } },
  });
}

// ── Audio features by year ──
async function renderFeaturesYear() {
  const data = await window.dashboardCoreReady.fetchJSON('/api/features-by-year');
  mkChart('chart-features-year', {
    type: 'line',
    data: {
      labels: data.map(d => d.year),
      datasets: [
        { label: 'Danceability', data: data.map(d => d.danceability), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.05)', fill: true, tension: 0.4, pointRadius: 0 },
        { label: 'Energy',       data: data.map(d => d.energy),       borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.05)', fill: true, tension: 0.4, pointRadius: 0 },
        { label: 'Valence',      data: data.map(d => d.valence),      borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.05)', fill: true, tension: 0.4, pointRadius: 0 },
      ],
    },
    options: { ...BASE_OPTS, scales: { ...BASE_OPTS.scales, y: { ...BASE_OPTS.scales.y, min: 0, max: 1 } } },
  });
}

// ── Radar chart ──
async function renderRadar() {
  const data = await window.dashboardCoreReady.fetchJSON('/api/audio-features');
  const labels = ['Danceability','Energy','Speechiness','Acousticness','Instrumentalness','Valence'];
  mkChart('chart-radar', {
    type: 'radar',
    data: {
      labels,
      datasets: data.slice(0,5).map((g, i) => ({
        label: g.genre,
        data: [g.danceability, g.energy, g.speechiness, g.acousticness, g.instrumentalness, g.valence],
        borderColor: PALETTE[i], backgroundColor: PALETTE[i] + '22', pointBackgroundColor: PALETTE[i], borderWidth: 1.5, pointRadius: 3,
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { color: '#8b9cc8', font: { size: 11 }, boxWidth: 10 } }, tooltip: BASE_OPTS.plugins.tooltip },
      scales: { r: { grid: { color: 'rgba(255,255,255,0.08)' }, ticks: { color: '#4a5578', backdropColor: 'transparent', font: { size: 10 } }, pointLabels: { color: '#8b9cc8', font: { size: 11 } }, angleLines: { color: 'rgba(255,255,255,0.08)' } } },
    },
  });
}

// ── Top artists ──
async function renderTopArtists() {
  const data = await window.dashboardCoreReady.fetchJSON('/api/top-artists');
  mkChart('chart-top-artists', {
    type: 'bar',
    data: {
      labels: data.map(d => d.artist.length > 22 ? d.artist.substring(0,22)+'…' : d.artist),
      datasets: [{ label: 'Favoritos', data: data.map(d => d.count), backgroundColor: PALETTE.map(c => c + 'cc'), borderRadius: 6 }],
    },
    options: { ...BASE_OPTS, indexAxis: 'y', plugins: { ...BASE_OPTS.plugins, legend: { display: false } } },
  });
}

// ── Music genres ──
async function renderMusicGenres() {
  const data = await window.dashboardCoreReady.fetchJSON('/api/genres');
  mkChart('chart-music-genres', {
    type: 'bar',
    data: {
      labels: data.map(d => d.genre),
      datasets: [{ label: 'Canciones', data: data.map(d => d.count), backgroundColor: data.map((_,i) => PALETTE[i % PALETTE.length] + 'cc'), borderColor: data.map((_,i) => PALETTE[i % PALETTE.length]), borderWidth: 1, borderRadius: 6 }],
    },
    options: { ...BASE_OPTS, indexAxis: 'y', plugins: { ...BASE_OPTS.plugins, legend: { display: false }, datalabels: { display: false } } },
  });
}

// ── Music popularity distribution ──
async function renderMusicPopularity() {
  const data = await window.dashboardCoreReady.fetchJSON('/api/popularity');
  mkChart('chart-music-popularity', {
    type: 'bar',
    data: {
      labels: data.map(d => d.bucket + '-' + (d.bucket + 9)),
      datasets: [{ label: 'Tracks', data: data.map(d => d.count), backgroundColor: PALETTE.map(c => c + 'bb'), borderRadius: 5 }],
    },
    options: { ...BASE_OPTS, plugins: { ...BASE_OPTS.plugins, legend: { display: false } } },
  });
}

// ── Favorites distribution ──
async function renderFavsDist() {
  const data = await window.dashboardCoreReady.fetchJSON('/api/favorites-dist');
  mkChart('chart-favs-dist', {
    type: 'line',
    data: {
      labels: data.map(d => d.favorites + ' favs'),
      datasets: [{ label: 'Usuarios', data: data.map(d => d.users), borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.15)', fill: true, tension: 0.4, pointRadius: 3, pointBackgroundColor: '#8b5cf6' }],
    },
    options: { ...BASE_OPTS, plugins: { ...BASE_OPTS.plugins, legend: { display: false } } },
  });
}

// ── Populations charts ──
async function renderPopulations(providedData) {
  const data = providedData || await window.dashboardCoreReady.fetchJSON('/api/users-by-population');
  if (!Array.isArray(data) || data.length === 0) {
    window.dashboardCoreReady.loadPopulationKPI([]);
    return;
  }
  window.dashboardCoreReady.loadPopulationKPI(data);
  mkChart('chart-populations', {
    type: 'bar',
    data: {
      labels: data.map(d => d.population),
      datasets: [{ label: 'Usuarios', data: data.map(d => d.count), backgroundColor: PALETTE.map(c => c + 'cc'), borderRadius: 5 }],
    },
    options: { ...BASE_OPTS, plugins: { ...BASE_OPTS.plugins, legend: { display: false } } },
  });
  mkChart('chart-populations-pie', {
    type: 'doughnut',
    data: {
      labels: data.map(d => d.population),
      datasets: [{ data: data.map(d => d.count), backgroundColor: PALETTE.map(c => c + 'dd'), borderColor: '#111827', borderWidth: 2 }],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#8b9cc8', font: { size: 11 }, boxWidth: 12 } }, tooltip: BASE_OPTS.plugins.tooltip }, cutout: '60%' },
  });
}

// ── Table sizes chart ──
async function renderStorageCharts(storageData) {
  const tables = storageData.tables || [];
  mkChart('chart-table-sizes', {
    type: 'doughnut',
    data: {
      labels: tables.map(t => t.table),
      datasets: [{ data: tables.map(t => Number(t.size_bytes)), backgroundColor: PALETTE.map(c => c + 'dd'), borderColor: '#111827', borderWidth: 2 }],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#8b9cc8', font: { size: 11 }, boxWidth: 12 } }, tooltip: BASE_OPTS.plugins.tooltip }, cutout: '55%' },
  });
  mkChart('chart-table-rows', {
    type: 'bar',
    data: {
      labels: tables.map(t => t.table),
      datasets: [{ label: 'Filas', data: tables.map(t => Number(t.total_rows)), backgroundColor: PALETTE.map(c => c + 'cc'), borderRadius: 8 }],
    },
    options: { ...BASE_OPTS, plugins: { ...BASE_OPTS.plugins, legend: { display: false } } },
  });
}

// ── Memory gauge ──
function renderMemGauge(pct) {
  const color = pct < 60 ? '#10b981' : pct < 80 ? '#f59e0b' : '#ef4444';
  mkChart('chart-mem-gauge', {
    type: 'doughnut',
    data: {
      datasets: [{ data: [pct, 100 - pct], backgroundColor: [color, 'rgba(255,255,255,0.05)'], borderWidth: 0, circumference: 270, rotation: 225 }],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, cutout: '78%' },
  });
}

// ── Benchmark run chart ──
function renderBenchRuns(d) {
  const baseline = d.baseline;
  mkChart('chart-bench-runs', {
    type: 'bar',
    data: {
      labels: d.runs.map((_,i) => 'Ejecución ' + (i+1)),
      datasets: [
        { label: 'Tiempo (ms)', data: d.runs, backgroundColor: d.runs.map(v => v <= baseline*1.5 ? '#10b981cc' : v <= baseline*3 ? '#f59e0bcc' : '#ef4444cc'), borderRadius: 6 },
        { label: 'Baseline', data: d.runs.map(() => baseline), type: 'line', borderColor: '#3b82f6', borderDash: [5,4], borderWidth: 2, pointRadius: 0, fill: false },
        { label: 'Media', data: d.runs.map(() => d.mean), type: 'line', borderColor: '#8b5cf6', borderDash: [3,3], borderWidth: 2, pointRadius: 0, fill: false },
      ],
    },
    options: { ...BASE_OPTS },
  });

  mkChart('chart-bench-compare', {
    type: 'bar',
    data: {
      labels: ['Baseline', 'Media Obtenida', 'IC Low', 'IC High'],
      datasets: [{ label: 'ms', data: [baseline, d.mean, d.ci_low, d.ci_high], backgroundColor: ['#3b82f6cc','#8b5cf6cc','#10b981cc','#f59e0bcc'], borderRadius: 8 }],
    },
    options: { ...BASE_OPTS, plugins: { ...BASE_OPTS.plugins, legend: { display: false } } },
  });

  const perfPct = Math.min(200, Math.round((d.mean / baseline) * 100));
  const color = d.status === 'OK' ? '#10b981' : d.status === 'WARNING' ? '#f59e0b' : '#ef4444';
  mkChart('chart-perf-gauge', {
    type: 'doughnut',
    data: {
      datasets: [{ data: [Math.min(perfPct, 100), Math.max(0, 100 - Math.min(perfPct, 100))], backgroundColor: [color, 'rgba(255,255,255,0.05)'], borderWidth: 0, circumference: 270, rotation: 225 }],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, cutout: '78%' },
  });

  mkChart('chart-ci', {
    type: 'scatter',
    data: {
      datasets: [
        { label: 'Intervalo', data: [{x: d.ci_low, y: 1}, {x: d.ci_high, y: 1}], borderColor: '#3b82f6', backgroundColor: '#3b82f6', pointRadius: 8 },
        { label: 'Media', data: [{x: d.mean, y: 1}], borderColor: '#8b5cf6', backgroundColor: '#8b5cf6', pointRadius: 10, pointStyle: 'triangle' },
        { label: 'Baseline', data: [{x: baseline, y: 1}], borderColor: '#10b981', backgroundColor: '#10b981', pointRadius: 8, pointStyle: 'rectRot' },
      ],
    },
    options: {
      ...BASE_OPTS,
      scales: {
        x: { ...BASE_OPTS.scales.x, title: { display: true, text: 'Tiempo (ms)', color: '#4a5578' } },
        y: { display: false },
      },
    },
  });
}

window.dashboardCharts = { renderGenres, renderPopularity, renderTopTracksChart, renderTracksYear, renderFeaturesYear, renderRadar, renderTopArtists, renderMusicGenres, renderMusicPopularity, renderFavsDist, renderPopulations, renderStorageCharts, renderMemGauge, renderBenchRuns, mkSparkline };

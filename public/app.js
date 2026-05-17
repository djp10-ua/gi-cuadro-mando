/* ── MAIN ENTRY POINT ── */
document.addEventListener('DOMContentLoaded', async () => {
  const { loadCounts, loadSystem, loadStorage, loadTopTracksTable, loadBenchmark, setStatus, setLastUpdate, activateSection, fetchJSON } = window.dashboardCoreReady;
  const { renderGenres, renderPopularity, renderTopTracksChart, renderTracksYear, renderFeaturesYear, renderRadar, renderTopArtists, renderFavsDist, renderPopulations, renderStorageCharts, renderMemGauge, renderBenchRuns, mkSparkline } = window.dashboardCharts;
  const REFRESH_INTERVAL_MS = 30000;

  const overlay = document.getElementById('loading-overlay');

  // ── Clock ──
  const clockEl = document.getElementById('topbar-clock');
  setInterval(() => { if (clockEl) clockEl.textContent = new Date().toLocaleTimeString('es-ES'); }, 1000);
  if (clockEl) clockEl.textContent = new Date().toLocaleTimeString('es-ES');

  // ── Navigation ──
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      const href = item.getAttribute('href').replace('#', '');
      activateSection(href);
    });
  });

  // ── Load all data ──
  async function loadAll() {
    overlay.classList.remove('hidden');
    try {
      // Parallel first load
      const [counts, sysData, storageData, topTracks, benchd, populations] = await Promise.allSettled([
        loadCounts(),
        loadSystem(),
        loadStorage(),
        loadTopTracksTable(),
        loadBenchmark(),
        fetchJSON('/api/users-by-population'),
      ]);

      // Sparklines (decorative)
      mkSparkline('spark-tracks', '#3b82f6');
      mkSparkline('spark-users', '#8b5cf6');
      mkSparkline('spark-addr', '#10b981');
      mkSparkline('spark-favs', '#f59e0b');

      // Overview charts
      await Promise.allSettled([
        renderGenres(),
        renderPopularity(),
        renderTopTracksChart(),
        renderTracksYear(),
      ]);

      // Storage charts
      if (storageData.status === 'fulfilled') {
        await renderStorageCharts(storageData.value);
      }
      if (sysData.status === 'fulfilled') {
        renderMemGauge(sysData.value.pct);
      }

      // Music charts
      await Promise.allSettled([
        renderFeaturesYear(),
        renderRadar(),
        renderTopArtists(),
        renderFavsDist(),
      ]);

      // Users charts
      if (populations.status === 'fulfilled') {
        await renderPopulations(populations.value);
      } else {
        document.getElementById('kv-populations').textContent = '—';
      }
      if (counts.status === 'fulfilled') {
        const c = counts.value;
        document.getElementById('kv-users2').textContent = c.lista_usuarios >= 1000 ? (c.lista_usuarios / 1000).toFixed(1) + 'K' : c.lista_usuarios;
        document.getElementById('kv-favs2').textContent = c.favoritas >= 1000 ? (c.favoritas / 1000).toFixed(1) + 'K' : c.favoritas;
        const avg = c.lista_usuarios > 0 ? (c.favoritas / c.lista_usuarios).toFixed(1) : '—';
        document.getElementById('kv-avg-favs').textContent = avg;
      }

      // Performance charts
      if (benchd.status === 'fulfilled') {
        renderBenchRuns(benchd.value);
      }

      setStatus(true, 'Conectado · ClickHouse');
      setLastUpdate();
    } catch (err) {
      console.error(err);
      setStatus(false, 'Error de conexión');
    } finally {
      overlay.classList.add('hidden');
    }
  }

  // ── Refresh button ──
  document.getElementById('refresh-btn')?.addEventListener('click', loadAll);

  // ── Initial load ──
  await loadAll();
  // setInterval(loadAll, REFRESH_INTERVAL_MS);
});

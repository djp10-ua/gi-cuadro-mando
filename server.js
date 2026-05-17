const express = require('express');
const { createClient } = require('@clickhouse/client');
const cors = require('cors');
const path = require('path');
const os = require('os');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ClickHouse client configuration
// Adjust host/port/username/password/database as needed
const clickhouse = createClient({
  url: 'http://localhost:8123',
  username: 'default',
  password: '',
  database: 'default',
});

// ─── HELPERS ──────────────────────────────────────────────────────────────────

async function query(sql) {
  const result = await clickhouse.query({ query: sql, format: 'JSONEachRow' });
  return result.json();
}

// ─── API ENDPOINTS ────────────────────────────────────────────────────────────

// 1. System info (disk / OS)
app.get('/api/system', async (req, res) => {
  try {
    const totalMem = os.totalmem();
    const freeMem  = os.freemem();
    const platform = os.platform();
    const cpus     = os.cpus().length;
    const loadAvg  = os.loadavg();

    // ClickHouse system metrics
    const diskRows = await query(`
      SELECT metric, value
      FROM system.metrics
      WHERE metric IN ('DiskAvailable', 'DiskTotal', 'MemoryTracking', 'BackgroundPoolTask')
    `).catch(() => []);

    const asyncMetrics = await query(`
      SELECT metric, value
      FROM system.asynchronous_metrics
      WHERE metric IN ('DiskAvailable', 'DiskTotal', 'OSMemoryAvailable', 'OSMemoryTotal',
                       'jemalloc.resident', 'jemalloc.allocated')
    `).catch(() => []);

    const metricsMap = {};
    [...diskRows, ...asyncMetrics].forEach(r => { metricsMap[r.metric] = Number(r.value); });

    res.json({
      os: { totalMem, freeMem, platform, cpus, loadAvg },
      clickhouse: metricsMap,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Database & table sizes
app.get('/api/storage', async (req, res) => {
  try {
    const tables = await query(`
      SELECT
        table,
        formatReadableSize(sum(bytes_on_disk)) AS size_readable,
        sum(bytes_on_disk)                     AS size_bytes,
        sum(rows)                              AS total_rows,
        count()                                AS parts
      FROM system.parts
      WHERE database = 'default' AND active = 1
      GROUP BY table
      ORDER BY size_bytes DESC
    `);

    const dbSize = await query(`
      SELECT
        formatReadableSize(sum(bytes_on_disk)) AS total_size_readable,
        sum(bytes_on_disk)                     AS total_size_bytes
      FROM system.parts
      WHERE database = 'default' AND active = 1
    `);

    res.json({ tables, dbSize: dbSize[0] || {} });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Total records per table
app.get('/api/counts', async (req, res) => {
  try {
    const counts = await Promise.all([
      query(`SELECT count() AS cnt FROM default.spotify_tracks`),
      query(`SELECT count() AS cnt FROM default.lista_usuarios`),
      query(`SELECT count() AS cnt FROM default.lista_direcciones`),
      query(`SELECT count() AS cnt FROM default.favoritas`),
    ]);
    res.json({
      spotify_tracks:    Number(counts[0][0]?.cnt ?? 0),
      lista_usuarios:    Number(counts[1][0]?.cnt ?? 0),
      lista_direcciones: Number(counts[2][0]?.cnt ?? 0),
      favoritas:         Number(counts[3][0]?.cnt ?? 0),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Top genres by track count
app.get('/api/genres', async (req, res) => {
  try {
    const rows = await query(`
      SELECT genre, count() AS cnt
      FROM default.spotify_tracks
      WHERE genre != ''
      GROUP BY genre
      ORDER BY cnt DESC
      LIMIT 15
    `);
    res.json(rows.map(r => ({ genre: r.genre, count: Number(r.cnt) })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Popularity distribution (histogram buckets)
app.get('/api/popularity', async (req, res) => {
  try {
    const rows = await query(`
      SELECT
        intDiv(popularity, 10) * 10 AS bucket,
        count()                      AS cnt
      FROM default.spotify_tracks
      GROUP BY bucket
      ORDER BY bucket ASC
    `);
    res.json(rows.map(r => ({ bucket: Number(r.bucket), count: Number(r.cnt) })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Top artists by favorites
app.get('/api/top-artists', async (req, res) => {
  try {
    const rows = await query(`
      SELECT st.artist_name, count() AS fav_count
      FROM default.favoritas f
      JOIN default.spotify_tracks st ON f.track_id = st.track_id
      GROUP BY st.artist_name
      ORDER BY fav_count DESC
      LIMIT 10
    `);
    res.json(rows.map(r => ({ artist: r.artist_name, count: Number(r.fav_count) })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Tracks per release year
app.get('/api/tracks-by-year', async (req, res) => {
  try {
    const rows = await query(`
      SELECT release_year AS yr, count() AS cnt
      FROM default.spotify_tracks
      WHERE release_year > 1950 AND release_year <= toYear(now())
      GROUP BY yr
      ORDER BY yr ASC
    `);
    res.json(rows.map(r => ({ year: Number(r.yr), count: Number(r.cnt) })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Audio features averages per genre (radar data)
app.get('/api/audio-features', async (req, res) => {
  try {
    const rows = await query(`
      SELECT
        genre,
        round(avg(danceability),3)      AS danceability,
        round(avg(energy),3)            AS energy,
        round(avg(speechiness),3)       AS speechiness,
        round(avg(acousticness),3)      AS acousticness,
        round(avg(instrumentalness),3)  AS instrumentalness,
        round(avg(valence),3)           AS valence,
        count()                         AS cnt
      FROM default.spotify_tracks
      WHERE genre != ''
      GROUP BY genre
      ORDER BY cnt DESC
      LIMIT 8
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Users by province
app.get('/api/users-by-province', async (req, res) => {
  try {
    const col = 'id_direcci\u00f3n';
    const rows = await query(`
      SELECT ld.provincia, count() AS cnt
      FROM default.lista_usuarios lu
      JOIN default.lista_direcciones ld ON lu.\`${col}\` = ld.id
      GROUP BY ld.provincia
      ORDER BY cnt DESC
      LIMIT 15
    `);
    res.json(rows.map(r => ({ province: r.provincia, count: Number(r.cnt) })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Average danceability & energy by year
app.get('/api/features-by-year', async (req, res) => {
  try {
    const rows = await query(`
      SELECT
        release_year AS yr,
        round(avg(danceability),3) AS danceability,
        round(avg(energy),3)       AS energy,
        round(avg(valence),3)      AS valence
      FROM default.spotify_tracks
      WHERE release_year >= 1970 AND release_year <= toYear(now())
      GROUP BY yr
      ORDER BY yr ASC
    `);
    res.json(rows.map(r => ({
      year: Number(r.yr),
      danceability: Number(r.danceability),
      energy: Number(r.energy),
      valence: Number(r.valence),
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. Performance benchmark – complex join query (with timing)
app.get('/api/benchmark', async (req, res) => {
  try {
    const runs = [];
    const col2 = 'id_direcci\u00f3n';
    const SQL = `
      SELECT st.genre, st.artist_name, count() AS fav_count, round(avg(st.popularity),2) AS avg_pop
      FROM default.favoritas f
      JOIN default.spotify_tracks st ON f.track_id = st.track_id
      JOIN default.lista_usuarios lu ON f.dni = lu.dni
      JOIN default.lista_direcciones ld ON lu.\`${col2}\` = ld.id
      GROUP BY st.genre, st.artist_name
      ORDER BY fav_count DESC
      LIMIT 20
    `;

    for (let i = 0; i < 5; i++) {
      const t0 = Date.now();
      await query(SQL);
      runs.push(Date.now() - t0);
    }

    const mean = runs.reduce((a, b) => a + b, 0) / runs.length;
    const std  = Math.sqrt(runs.map(v => (v - mean) ** 2).reduce((a, b) => a + b, 0) / runs.length);
    const z    = 1.96;
    const eps  = z * (std / Math.sqrt(runs.length));

    // Baseline values (set when the system is in normal/stable state)
    const BASELINE_MS = 150;

    res.json({
      runs,
      mean: Math.round(mean * 100) / 100,
      std:  Math.round(std  * 100) / 100,
      eps:  Math.round(eps  * 100) / 100,
      ci_low:  Math.round((mean - eps) * 100) / 100,
      ci_high: Math.round((mean + eps) * 100) / 100,
      baseline: BASELINE_MS,
      status: mean <= BASELINE_MS * 1.5 ? 'OK' : mean <= BASELINE_MS * 3 ? 'WARNING' : 'CRITICAL',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 12. Top tracks by popularity
app.get('/api/top-tracks', async (req, res) => {
  try {
    const rows = await query(`
      SELECT track_name, artist_name, popularity, genre, release_year
      FROM default.spotify_tracks
      ORDER BY popularity DESC
      LIMIT 10
    `);
    res.json(rows.map(r => ({
      track: r.track_name,
      artist: r.artist_name,
      popularity: Number(r.popularity),
      genre: r.genre,
      year: Number(r.release_year),
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 13. Favoritas per user (distribution)
app.get('/api/favorites-dist', async (req, res) => {
  try {
    const rows = await query(`
      SELECT cnt, count() AS users
      FROM (
        SELECT dni, count() AS cnt
        FROM default.favoritas
        GROUP BY dni
      )
      GROUP BY cnt
      ORDER BY cnt ASC
      LIMIT 20
    `);
    res.json(rows.map(r => ({ favorites: Number(r.cnt), users: Number(r.users) })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve frontend
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🎛️  Dashboard running → http://localhost:${PORT}`);
});

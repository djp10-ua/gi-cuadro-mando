const express = require('express');
const { createClient } = require('@clickhouse/client');
const cors = require('cors');
const path = require('path');
const os = require('os');
const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const USING_DEFAULT_AUTH = !process.env.ADMIN_USER || !process.env.ADMIN_PASSWORD;
const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL || 'http://localhost:8123';
const CLICKHOUSE_USER = process.env.CLICKHOUSE_USER || 'default';
const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD || '';
const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'default';
const QUERY_TIMEOUT_MS = Number(process.env.QUERY_TIMEOUT_MS || 15000);
const MIN_BENCHMARK_RUNS = 3;
const BENCHMARK_RUNS = Math.max(MIN_BENCHMARK_RUNS, Number(process.env.BENCHMARK_RUNS || 5));
const CLEAR_BENCHMARK_CACHE = (process.env.CLEAR_BENCHMARK_CACHE || 'true').toLowerCase() === 'true';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const BASELINE_FILE = path.join(DATA_DIR, 'baseline.json');

const baselines = loadBaselinesSync();

if (USING_DEFAULT_AUTH) {
  console.warn('⚠️  Using default admin credentials (admin/admin). Set ADMIN_USER and ADMIN_PASSWORD.');
}
if (process.env.NODE_ENV === 'production' && USING_DEFAULT_AUTH) {
  throw new Error('ADMIN_USER and ADMIN_PASSWORD are required in production mode');
}

function loadBaselinesSync() {
  try {
    const raw = fs.readFileSync(BASELINE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch (_) {}
  return {};
}

async function saveBaselines() {
  await fsp.mkdir(path.dirname(BASELINE_FILE), { recursive: true });
  await fsp.writeFile(BASELINE_FILE, JSON.stringify(baselines, null, 2), 'utf8');
}

function withBaseline(metricKey, current) {
  const currentNum = Number(current) || 0;
  if (!Object.prototype.hasOwnProperty.call(baselines, metricKey)) {
    baselines[metricKey] = currentNum;
    saveBaselines().catch(err => {
      console.warn('[BASELINE] Failed to save baseline:', makeMessage(err));
    });
  }
  const reference = Number(baselines[metricKey]) || 0;
  const delta = currentNum - reference;
  const deltaPct = reference > 0 ? (delta / reference) * 100 : null;
  return { current: currentNum, reference, delta, deltaPct };
}

function makeMessage(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err.message) return err.message;
  if (err.code === 'ECONNREFUSED') return 'Cannot connect to ClickHouse (ECONNREFUSED)';
  if (Array.isArray(err.errors) && err.errors[0] && err.errors[0].message) return err.errors[0].message;
  if (Array.isArray(err.errors) && err.errors[0] && err.errors[0].code === 'ECONNREFUSED') {
    return 'Cannot connect to ClickHouse (ECONNREFUSED)';
  }
  if (err.cause && err.cause.message) return err.cause.message;
  if (err.cause && err.cause.code === 'ECONNREFUSED') return 'Cannot connect to ClickHouse (ECONNREFUSED)';
  return 'Unknown error';
}

function sendApiError(res, err, status = 500) {
  const message = makeMessage(err);
  console.error('[API ERROR]', message, err && err.stack ? err.stack : err);
  res.status(status).json({ error: message, status });
}

function safeEqual(a, b) {
  const aBuf = Buffer.from(String(a || ''), 'utf8');
  const bBuf = Buffer.from(String(b || ''), 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function getBasicAuth(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return null;
  const plain = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const separator = plain.indexOf(':');
  if (separator < 0) return null;
  return {
    user: plain.slice(0, separator),
    pass: plain.slice(separator + 1),
  };
}

app.use((req, res, next) => {
  const auth = getBasicAuth(req);
  if (auth && safeEqual(auth.user, ADMIN_USER) && safeEqual(auth.pass, ADMIN_PASSWORD)) {
    return next();
  }
  res.setHeader('WWW-Authenticate', 'Basic realm="GI Cuadro de Mando Admin"');
  return res.status(401).send('Access restricted (admin).');
});

app.use(express.static(path.join(__dirname, 'public')));

// ClickHouse client configuration
const clickhouse = createClient({
  url: CLICKHOUSE_URL,
  username: CLICKHOUSE_USER,
  password: CLICKHOUSE_PASSWORD,
  database: CLICKHOUSE_DATABASE,
});

// ─── HELPERS ──────────────────────────────────────────────────────────────────

async function query(sql) {
  const queryPromise = clickhouse
    .query({ query: sql, format: 'JSONEachRow' })
    .then(result => result.json());

  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Query timeout (${QUERY_TIMEOUT_MS} ms)`)), QUERY_TIMEOUT_MS);
  });

  try {
    return await Promise.race([queryPromise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeId(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

async function resolveUserAddressColumn() {
  const columns = await query('DESCRIBE TABLE default.lista_usuarios');
  const names = columns.map(c => String(c.name || ''));

  const exactCandidates = ['id_dirección', 'id_direccion'];
  const exact = exactCandidates.find(candidate => names.includes(candidate));
  if (exact) return exact;

  const normalized = names.find(name => normalizeId(name) === 'id_direccion');
  if (normalized) return normalized;

  throw new Error('Address column not found in default.lista_usuarios');
}

async function getServerDiskInfo() {
  try {
    const stats = await fsp.statfs(process.cwd());
    const blockSize = Number(stats.bsize || 0);
    const freeBlocks = Number(stats.bavail || stats.bfree || 0);
    const totalBlocks = Number(stats.blocks || 0);
    return {
      freeBytes: freeBlocks * blockSize,
      totalBytes: totalBlocks * blockSize,
    };
  } catch (_) {
    return { freeBytes: 0, totalBytes: 0 };
  }
}

// ─── API ENDPOINTS ────────────────────────────────────────────────────────────

// 1. System info (disk / OS)
app.get('/api/system', async (req, res) => {
  try {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const platform = os.platform();
    const cpus = os.cpus().length;
    const loadAvg = os.loadavg();
    const disk = await getServerDiskInfo();

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
    [...diskRows, ...asyncMetrics].forEach(r => {
      metricsMap[r.metric] = Number(r.value);
    });

    res.json({
      os: { totalMem, freeMem, platform, cpus, loadAvg },
      host: {
        diskFreeBytes: disk.freeBytes,
        diskTotalBytes: disk.totalBytes,
      },
      clickhouse: metricsMap,
      kpis: {
        ramTotal: withBaseline('system.ramTotal', totalMem),
        ramFree: withBaseline('system.ramFree', freeMem),
        cpuCores: withBaseline('system.cpuCores', cpus),
        diskFree: withBaseline('system.diskFree', disk.freeBytes),
      },
    });
  } catch (err) {
    sendApiError(res, err);
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

    const dbTotalBytes = Number(dbSize[0]?.total_size_bytes || 0);

    res.json({
      tables,
      dbSize: dbSize[0] || {},
      kpis: {
        dbTotalBytes: withBaseline('storage.dbTotalBytes', dbTotalBytes),
        tableSizes: tables.map(t => ({
          table: t.table,
          size: withBaseline(`storage.table.${t.table}.sizeBytes`, Number(t.size_bytes || 0)),
        })),
      },
    });
  } catch (err) {
    sendApiError(res, err);
  }
});

// 3. Total records per table
app.get('/api/counts', async (req, res) => {
  try {
    const counts = await Promise.all([
      query('SELECT count() AS cnt FROM default.spotify_tracks'),
      query('SELECT count() AS cnt FROM default.lista_usuarios'),
      query('SELECT count() AS cnt FROM default.lista_direcciones'),
      query('SELECT count() AS cnt FROM default.favoritas'),
    ]);
    res.json({
      spotify_tracks: Number(counts[0][0]?.cnt ?? 0),
      lista_usuarios: Number(counts[1][0]?.cnt ?? 0),
      lista_direcciones: Number(counts[2][0]?.cnt ?? 0),
      favoritas: Number(counts[3][0]?.cnt ?? 0),
    });
  } catch (err) {
    sendApiError(res, err);
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
    sendApiError(res, err);
  }
});

// 5. Popularity distribution (histogram buckets)
app.get('/api/popularity', async (req, res) => {
  try {
    const rows = await query(`
      SELECT
        intDiv(popularity, 10) * 10 AS bucket,
        count()                     AS cnt
      FROM default.spotify_tracks
      GROUP BY bucket
      ORDER BY bucket ASC
    `);
    res.json(rows.map(r => ({ bucket: Number(r.bucket), count: Number(r.cnt) })));
  } catch (err) {
    sendApiError(res, err);
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
    sendApiError(res, err);
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
    sendApiError(res, err);
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
    sendApiError(res, err);
  }
});

// 9. Users by province
app.get('/api/users-by-province', async (req, res) => {
  try {
    const col = await resolveUserAddressColumn();
    const escapedCol = col.replace(/`/g, '``');
    const rows = await query(`
      SELECT ld.provincia, count() AS cnt
      FROM default.lista_usuarios lu
      JOIN default.lista_direcciones ld ON lu.\`${escapedCol}\` = ld.id
      WHERE ld.provincia IS NOT NULL AND ld.provincia != ''
      GROUP BY ld.provincia
      ORDER BY cnt DESC
      LIMIT 15
    `);
    res.json(rows.map(r => ({ province: r.provincia, count: Number(r.cnt) })));
  } catch (err) {
    sendApiError(res, err);
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
    res.json(
      rows.map(r => ({
        year: Number(r.yr),
        danceability: Number(r.danceability),
        energy: Number(r.energy),
        valence: Number(r.valence),
      })),
    );
  } catch (err) {
    sendApiError(res, err);
  }
});

// 11. Performance benchmark – complex join query (with timing)
app.get('/api/benchmark', async (req, res) => {
  try {
    const topTables = await query(`
      SELECT
        table,
        sum(bytes_on_disk) AS size_bytes
      FROM system.parts
      WHERE database = 'default' AND active = 1
      GROUP BY table
      ORDER BY size_bytes DESC
      LIMIT 3
    `);

    const col = await resolveUserAddressColumn();
    const escapedCol = col.replace(/`/g, '``');

    const SQL = `
      SELECT st.genre, st.artist_name, count() AS fav_count, round(avg(st.popularity),2) AS avg_pop
      FROM default.favoritas f
      JOIN default.spotify_tracks st ON f.track_id = st.track_id
      JOIN default.lista_usuarios lu ON f.dni = lu.dni
      JOIN default.lista_direcciones ld ON lu.\`${escapedCol}\` = ld.id
      GROUP BY st.genre, st.artist_name
      ORDER BY fav_count DESC
      LIMIT 20
    `;

    const runs = [];
    for (let i = 0; i < BENCHMARK_RUNS; i++) {
      if (CLEAR_BENCHMARK_CACHE) {
        await query('SYSTEM DROP FILESYSTEM CACHE').catch(err => {
          console.warn('[BENCHMARK] Failed to clear filesystem cache:', makeMessage(err));
        });
      }
      const start = process.hrtime.bigint();
      await query(SQL);
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      runs.push(Math.round(elapsedMs * 100) / 100);
    }

    const n = runs.length;
    const mean = runs.reduce((a, b) => a + b, 0) / n;
    const std = Math.sqrt(runs.map(v => (v - mean) ** 2).reduce((a, b) => a + b, 0) / n);
    const z = 1.96;
    const eps = z * (std / Math.sqrt(n));
    const hadBaseline = Object.prototype.hasOwnProperty.call(baselines, 'benchmark.meanMs');
    const baselineKpi = withBaseline('benchmark.meanMs', mean);
    const baseline = baselineKpi.reference ?? mean;
    const status = !hadBaseline
      ? 'BASELINE_SET'
      : baseline > 0
      ? (mean <= baseline * 1.5 ? 'OK' : mean <= baseline * 3 ? 'WARNING' : 'CRITICAL')
      : 'UNKNOWN';

    res.json({
      runs,
      n,
      mean: Math.round(mean * 100) / 100,
      std: Math.round(std * 100) / 100,
      eps: Math.round(eps * 100) / 100,
      ci_low: Math.round((mean - eps) * 100) / 100,
      ci_high: Math.round((mean + eps) * 100) / 100,
      baseline: Math.round(baseline * 100) / 100,
      status,
      query: SQL.trim(),
      topTables: topTables.map(t => ({ table: t.table, sizeBytes: Number(t.size_bytes || 0) })),
      kpi: {
        latencyMs: {
          current: Math.round(baselineKpi.current * 100) / 100,
          reference: Math.round(baselineKpi.reference * 100) / 100,
          delta: Math.round(baselineKpi.delta * 100) / 100,
          deltaPct: baselineKpi.deltaPct === null ? null : Math.round(baselineKpi.deltaPct * 100) / 100,
        },
      },
    });
  } catch (err) {
    sendApiError(res, err);
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
    res.json(
      rows.map(r => ({
        track: r.track_name,
        artist: r.artist_name,
        popularity: Number(r.popularity),
        genre: r.genre,
        year: Number(r.release_year),
      })),
    );
  } catch (err) {
    sendApiError(res, err);
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
    sendApiError(res, err);
  }
});

// Serve frontend
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🎛️  Dashboard running → http://localhost:${PORT}`);
  console.log(`🔐 Basic auth admin user: ${ADMIN_USER}`);
});

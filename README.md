# GI Cuadro de Mando

Dashboard web local para monitorización de recursos/KPIs con ClickHouse.

## Requisitos

- Node.js 18+
- ClickHouse accesible en `http://localhost:8123`
- Tablas en schema `default`:
  - `spotify_tracks`
  - `favoritas`
  - `lista_usuarios`
  - `lista_direcciones`

## Instalación

```bash
npm install
```

## Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `ADMIN_USER` | `admin` | Usuario Basic Auth para acceder al panel/API |
| `ADMIN_PASSWORD` | `admin` | Password Basic Auth |
| `CLICKHOUSE_URL` | `http://localhost:8123` | URL de ClickHouse |
| `CLICKHOUSE_USER` | `default` | Usuario ClickHouse |
| `CLICKHOUSE_PASSWORD` | `` | Password ClickHouse |
| `CLICKHOUSE_DATABASE` | `default` | Base de datos |
| `BENCHMARK_RUNS` | `5` | Nº de ejecuciones del benchmark |
| `QUERY_TIMEOUT_MS` | `15000` | Timeout por consulta |
| `CLEAR_BENCHMARK_CACHE` | `true` | Intenta ejecutar `SYSTEM DROP FILESYSTEM CACHE` antes de cada muestra del benchmark (requiere permisos) |
| `DATA_DIR` | `./data` | Carpeta local para persistir baselines (`baseline.json`) |

## Ejecutar en local

```bash
npm start
```

Abrir: `http://localhost:3000`

El panel y los endpoints `/api/*` están protegidos por **Basic Auth**.

## Endpoints clave

- `GET /api/storage`: tamaño total BD + tamaño por tabla + baseline persistente
- `GET /api/system`: RAM, CPU, disco libre del host + baseline persistente
- `GET /api/users-by-population`: top 10 usuarios agregados por población
- `GET /api/benchmark`: benchmark de consulta compleja (5 ejecuciones, media, desviación, IC95, baseline persistente, query usada)

## Baselines persistentes

La primera medición de cada KPI se guarda en `data/baseline.json` y se usa como referencia en siguientes lecturas.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bearerAuth } from 'hono/bearer-auth';

export type D1PreparedStatement = {
  bind: (...values: unknown[]) => D1PreparedStatement;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  all: <T = Record<string, unknown>>() => Promise<{ results?: T[] }>;
  run: () => Promise<unknown>;
};

export type D1Database = {
  prepare: (query: string) => D1PreparedStatement;
  batch: (statements: D1PreparedStatement[]) => Promise<unknown[]>;
};

export type Env = {
  FOLIA_SYNC_DB: D1Database;
  SYNC_TOKEN: string;
  DASHBOARD_TOKEN?: string;
};

const SCHEMA_VERSION = 1;
const THEME_BUCKET_COUNT = 256;
const MAX_THEME_BATCH_SIZE = 500;
const MAX_THEME_BUCKET_REQUEST_SIZE = 32;
const DEFAULT_THEME_LIST_LIMIT = 500;
const MAX_THEME_LIST_LIMIT = 1000;

const hashSyncString = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const getThemeBucketId = (fingerprint: string) => hashSyncString(fingerprint) % THEME_BUCKET_COUNT;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

let schemaEnsured = false;

const ensureSchema = async (db: D1Database) => {
  if (schemaEnsured) return;
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS themes (
        fingerprint TEXT PRIMARY KEY,
        bucket_id INTEGER NOT NULL,
        theme_json TEXT NOT NULL,
        source TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS theme_buckets (
        bucket_id INTEGER PRIMARY KEY,
        count INTEGER NOT NULL,
        hash TEXT NOT NULL,
        updated_at TEXT
      )
    `),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_themes_updated_at ON themes(updated_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_themes_bucket_id ON themes(bucket_id)'),
  ]);
  schemaEnsured = true;
};

const parseThemeInput = (value: unknown) => {
  if (!isRecord(value)
    || typeof value.fingerprint !== 'string'
    || !value.fingerprint
    || typeof value.updatedAt !== 'string'
    || !isRecord(value.theme)
  ) {
    return null;
  }
  const source = value.source === 'auto' || value.source === 'fallback' || value.source === 'edited'
    ? value.source
    : 'manual';
  return { fingerprint: value.fingerprint, theme: value.theme, updatedAt: value.updatedAt, source };
};

const mapThemeRow = (row: { fingerprint: string; theme_json: string; source: string; updated_at: string }) => ({
  fingerprint: row.fingerprint,
  theme: JSON.parse(row.theme_json),
  source: row.source,
  updatedAt: row.updated_at,
});



const getThemeManifest = async (db: D1Database) => {
  const rows = await db
    .prepare('SELECT bucket_id, count, hash, updated_at FROM theme_buckets')
    .all<{ bucket_id: number; count: number; hash: string; updated_at: string | null }>();
  const buckets = Array.from({ length: THEME_BUCKET_COUNT }, (_, bucketId) => ({
    bucketId, count: 0, hash: '0', updatedAt: null as string | null,
  }));
  (rows.results ?? []).forEach((row) => {
    if (Number.isInteger(row.bucket_id) && row.bucket_id >= 0 && row.bucket_id < THEME_BUCKET_COUNT) {
      buckets[row.bucket_id] = {
        bucketId: row.bucket_id, count: Number(row.count), hash: row.hash, updatedAt: row.updated_at,
      };
    }
  });
  return { schemaVersion: SCHEMA_VERSION, bucketCount: THEME_BUCKET_COUNT, buckets };
};

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowHeaders: ['Authorization', 'Content-Type'],
}));

// Token length validation middleware
app.use('*', async (c, next) => {
  if (!c.env.SYNC_TOKEN || c.env.SYNC_TOKEN.length < 8) {
    return c.json({ ok: false, error: 'SYNC_TOKEN is too weak. Must be at least 8 characters long.' }, 500);
  }
  await next();
});

// Initialize Schema
app.use('*', async (c, next) => {
  if (c.req.path !== '/') {
    await ensureSchema(c.env.FOLIA_SYNC_DB);
  }
  await next();
});

// Dashboard Route
app.get('/', async (c) => {
  const dashboardToken = c.env.DASHBOARD_TOKEN;
  const reqToken = c.req.query('token');
  
  if (!dashboardToken || reqToken !== dashboardToken) {
    return c.text('Not Found', 404);
  }

  await ensureSchema(c.env.FOLIA_SYNC_DB);

  const settingsRow = await c.env.FOLIA_SYNC_DB
    .prepare('SELECT updated_at FROM settings WHERE key = ?')
    .bind('visual')
    .first<{ updated_at: string }>();
    
  const themesRow = await c.env.FOLIA_SYNC_DB
    .prepare('SELECT MAX(updated_at) AS themesUpdatedAt, SUM(count) AS themeCount FROM theme_buckets')
    .first<{ themesUpdatedAt: string | null; themeCount: number }>();

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Folia Sync Server</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-color: #000000;
            --dot-color: rgba(255, 255, 255, 0.1);
            --text-main: #ffffff;
            --text-muted: #94a3b8;
            --border-color: rgba(255, 255, 255, 0.1);
        }
        * { box-sizing: border-box; }
        body { 
            font-family: 'Inter', system-ui, sans-serif; 
            background-color: var(--bg-color);
            background-image: radial-gradient(var(--dot-color) 1px, transparent 1px);
            background-size: 24px 24px;
            color: var(--text-main); 
            min-height: 100vh;
            margin: 0;
            display: flex; 
            flex-direction: column;
            align-items: center;
            padding: 4rem 2rem; 
        }
        .header {
            width: 100%;
            max-width: 900px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 5rem;
        }
        .title {
            font-size: 1.5rem;
            font-weight: 700;
            margin: 0;
            letter-spacing: 0.02em;
        }
        .version-pill {
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid var(--border-color);
            padding: 0.25rem 0.75rem;
            border-radius: 9999px;
            font-size: 0.875rem;
            font-weight: 500;
            font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
            color: #cbd5e1;
        }
        .content {
            width: 100%;
            max-width: 900px;
        }
        .stats-grid { 
            display: grid; 
            grid-template-columns: repeat(3, 1fr); 
            gap: 2rem; 
            align-items: center;
        }
        .stat-item {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
            gap: 1rem;
        }
        .stat-value {
            font-size: 2.5rem;
            font-weight: 700;
            color: var(--text-main);
            line-height: 1.2;
        }
        .stat-value.text-base {
            font-size: 1.25rem;
            font-weight: 600;
        }
        .stat-label {
            font-size: 0.875rem;
            color: var(--text-main);
            font-weight: 500;
            letter-spacing: 0.05em;
        }
        .footer-note {
            margin-top: 5rem;
            padding-top: 1.5rem;
            border-top: 1px dashed var(--border-color);
            font-size: 0.875rem;
            color: var(--text-muted);
            line-height: 1.6;
        }
        .footer-note code {
            background: rgba(255, 255, 255, 0.1);
            padding: 0.15rem 0.35rem;
            border-radius: 4px;
            font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
            color: #e2e8f0;
        }
        .footer-note ul {
            margin: 0.5rem 0 0 0;
            padding-left: 1.25rem;
        }
        .footer-note li {
            margin-bottom: 0.25rem;
        }
        @media (max-width: 768px) {
            .stats-grid { grid-template-columns: 1fr; gap: 3rem; }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1 class="title">Folia Sync Server</h1>
        <div class="version-pill">v1.0.0</div>
    </div>
    
    <div class="content">
        <div class="stats-grid">
            <div class="stat-item">
                <div class="stat-value">${Number(themesRow?.themeCount ?? 0)}</div>
                <div class="stat-label">已同步主题数</div>
            </div>
            <div class="stat-item">
                <div class="stat-value text-base">${themesRow?.themesUpdatedAt ? new Date(themesRow.themesUpdatedAt).toLocaleString('zh-CN') : '暂无数据'}</div>
                <div class="stat-label">主题最近更新</div>
            </div>
            <div class="stat-item">
                <div class="stat-value text-base">${settingsRow?.updated_at ? new Date(settingsRow.updated_at).toLocaleString('zh-CN') : '暂无数据'}</div>
                <div class="stat-label">设置最近更新</div>
            </div>
        </div>

        <div class="footer-note">
            如果你遗忘了 <code>SYNC_TOKEN</code> 密钥：
            <ul>
                <li><strong>Cloudflare 部署</strong>：运行 <code>wrangler secret put SYNC_TOKEN</code> 重置覆盖。</li>
                <li><strong>自托管 (Node.js)</strong>：请检查服务器的 <code>.env</code> 文件配置。</li>
            </ul>
        </div>
    </div>
</body>
</html>`;

  return c.html(html);
});

// API Routes
app.get('/health', (c) => c.json({ ok: true, schemaVersion: SCHEMA_VERSION, backend: 'hono-sync' }));

const api = new Hono<{ Bindings: Env }>();

// Protect all API routes with Bearer Auth
api.use('*', async (c, next) => {
  const auth = bearerAuth({ token: c.env.SYNC_TOKEN });
  return auth(c as any, next);
});

api.get('/state', async (c) => {
  const settingsRow = await c.env.FOLIA_SYNC_DB
    .prepare('SELECT updated_at FROM settings WHERE key = ?')
    .bind('visual')
    .first<{ updated_at: string }>();
  const themesRow = await c.env.FOLIA_SYNC_DB
    .prepare('SELECT MAX(updated_at) AS themesUpdatedAt, SUM(count) AS themeCount FROM theme_buckets')
    .first<{ themesUpdatedAt: string | null; themeCount: number }>();
  return c.json({
    schemaVersion: SCHEMA_VERSION,
    settingsUpdatedAt: settingsRow?.updated_at ?? null,
    themesUpdatedAt: themesRow?.themesUpdatedAt ?? null,
    themeCount: Number(themesRow?.themeCount ?? 0),
  });
});

api.get('/settings', async (c) => {
  const row = await c.env.FOLIA_SYNC_DB
    .prepare('SELECT value_json FROM settings WHERE key = ?')
    .bind('visual')
    .first<{ value_json: string }>();
  return c.json(row ? JSON.parse(row.value_json) : null);
});

api.get('/themes/manifest', async (c) => c.json(await getThemeManifest(c.env.FOLIA_SYNC_DB)));

api.put('/settings', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || body.schemaVersion !== SCHEMA_VERSION || typeof body.updatedAt !== 'string' || !isRecord(body.data)) {
    return c.json({ ok: false, error: 'invalid_settings' }, 400);
  }
  await c.env.FOLIA_SYNC_DB
    .prepare(`
      INSERT INTO settings (key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
      WHERE excluded.updated_at >= settings.updated_at
    `)
    .bind('visual', JSON.stringify(body), body.updatedAt)
    .run();
  
  console.log(`[Sync] Updated settings (timestamp: ${body.updatedAt})`);
  return c.json({ ok: true });
});

api.post('/themes/get', async (c) => {
  const body = await c.req.json<{ fingerprints?: unknown[] }>().catch(() => null);
  const fingerprints = Array.from(new Set((body?.fingerprints ?? []).filter((value): value is string => (
    typeof value === 'string' && Boolean(value)
  )))).slice(0, MAX_THEME_BATCH_SIZE);
  if (fingerprints.length === 0) return c.json({ themes: [] });

  const placeholders = fingerprints.map(() => '?').join(',');
  const rows = await c.env.FOLIA_SYNC_DB
    .prepare(`SELECT fingerprint, theme_json, source, updated_at FROM themes WHERE fingerprint IN (${placeholders})`)
    .bind(...fingerprints)
    .all<{ fingerprint: string; theme_json: string; source: string; updated_at: string }>();
  return c.json({ themes: (rows.results ?? []).map(mapThemeRow) });
});

api.post('/themes/put', async (c) => {
  const body = await c.req.json<{ themes?: unknown[] }>().catch(() => null);
  const themes = (body?.themes ?? []).map(parseThemeInput);
  if (themes.some(theme => !theme) || themes.length > MAX_THEME_BATCH_SIZE) {
    return c.json({ ok: false, error: 'invalid_themes' }, 400);
  }

  const validThemes = themes as NonNullable<ReturnType<typeof parseThemeInput>>[];
  if (validThemes.length === 0) {
    return c.json({ ok: true, savedCount: 0 });
  }

  const fingerprints = validThemes.map(t => t.fingerprint);
  const placeholders = fingerprints.map(() => '?').join(',');
  
  const oldRows = await c.env.FOLIA_SYNC_DB
    .prepare(`SELECT fingerprint, updated_at FROM themes WHERE fingerprint IN (${placeholders})`)
    .bind(...fingerprints)
    .all<{ fingerprint: string; updated_at: string }>();
    
  const oldThemesMap = new Map(oldRows.results?.map(r => [r.fingerprint, r.updated_at]) ?? []);
  const bucketDiffs = new Map<number, { countDelta: number; hashDelta: number; maxUpdatedAt: string }>();

  validThemes.forEach(theme => {
    const bucketId = getThemeBucketId(theme.fingerprint);
    let bucketDiff = bucketDiffs.get(bucketId);
    if (!bucketDiff) {
      bucketDiff = { countDelta: 0, hashDelta: 0, maxUpdatedAt: theme.updatedAt };
      bucketDiffs.set(bucketId, bucketDiff);
    }
    
    const oldUpdatedAt = oldThemesMap.get(theme.fingerprint);
    if (!oldUpdatedAt) {
      bucketDiff.countDelta += 1;
      bucketDiff.hashDelta ^= hashSyncString(`${theme.fingerprint}\u0000${theme.updatedAt}`);
    } else if (theme.updatedAt >= oldUpdatedAt) {
      bucketDiff.hashDelta ^= hashSyncString(`${theme.fingerprint}\u0000${oldUpdatedAt}`);
      bucketDiff.hashDelta ^= hashSyncString(`${theme.fingerprint}\u0000${theme.updatedAt}`);
    }

    if (Date.parse(theme.updatedAt) > Date.parse(bucketDiff.maxUpdatedAt)) {
       bucketDiff.maxUpdatedAt = theme.updatedAt;
    }
  });

  const batchStatements: D1PreparedStatement[] = [];

  validThemes.forEach(theme => {
    batchStatements.push(c.env.FOLIA_SYNC_DB.prepare(`
      INSERT INTO themes (fingerprint, bucket_id, theme_json, source, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(fingerprint) DO UPDATE SET
        bucket_id = excluded.bucket_id,
        theme_json = excluded.theme_json,
        source = excluded.source,
        updated_at = excluded.updated_at
      WHERE excluded.updated_at >= themes.updated_at
    `).bind(
      theme.fingerprint,
      getThemeBucketId(theme.fingerprint),
      JSON.stringify(theme.theme),
      theme.source,
      theme.updatedAt,
    ));
  });

  bucketDiffs.forEach((diff, bucketId) => {
    batchStatements.push(c.env.FOLIA_SYNC_DB.prepare(`
      INSERT INTO theme_buckets (bucket_id, count, hash, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(bucket_id) DO UPDATE SET
        count = theme_buckets.count + excluded.count,
        hash = CAST(((CAST(theme_buckets.hash AS INTEGER) | CAST(excluded.hash AS INTEGER)) - (CAST(theme_buckets.hash AS INTEGER) & CAST(excluded.hash AS INTEGER))) AS TEXT),
        updated_at = MAX(theme_buckets.updated_at, excluded.updated_at)
    `).bind(
      bucketId,
      diff.countDelta,
      String(diff.hashDelta >>> 0),
      diff.maxUpdatedAt,
    ));
  });

  await c.env.FOLIA_SYNC_DB.batch(batchStatements);
  
  console.log(`[Sync] Saved ${validThemes.length} themes (batch update)`);
  return c.json({ ok: true, savedCount: validThemes.length });
});

api.post('/themes/bucket', async (c) => {
  const body = await c.req.json<{ bucketIds?: unknown[] }>().catch(() => null);
  const bucketIds = Array.from(new Set((body?.bucketIds ?? []).filter((value): value is number => (
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < THEME_BUCKET_COUNT
  )))).slice(0, MAX_THEME_BUCKET_REQUEST_SIZE);
  if (bucketIds.length === 0) return c.json({ themes: [] });

  const placeholders = bucketIds.map(() => '?').join(',');
  const rows = await c.env.FOLIA_SYNC_DB
    .prepare(`
      SELECT fingerprint, theme_json, source, updated_at
      FROM themes
      WHERE bucket_id IN (${placeholders})
      ORDER BY fingerprint ASC
    `)
    .bind(...bucketIds)
    .all<{ fingerprint: string; theme_json: string; source: string; updated_at: string }>();
  return c.json({ themes: (rows.results ?? []).map(mapThemeRow) });
});

api.post('/themes/list', async (c) => {
  const body = await c.req.json<{ cursor?: unknown; limit?: unknown }>().catch(() => null);
  const cursor = typeof body?.cursor === 'string' ? body.cursor : '';
  const requestedLimit = typeof body?.limit === 'number' && Number.isFinite(body.limit)
    ? Math.trunc(body.limit)
    : DEFAULT_THEME_LIST_LIMIT;
  const limit = Math.max(1, Math.min(MAX_THEME_LIST_LIMIT, requestedLimit));
  const rows = await c.env.FOLIA_SYNC_DB
    .prepare(`
      SELECT fingerprint, theme_json, source, updated_at
      FROM themes
      WHERE fingerprint > ?
      ORDER BY fingerprint ASC
      LIMIT ?
    `)
    .bind(cursor, limit)
    .all<{ fingerprint: string; theme_json: string; source: string; updated_at: string }>();
  const themes = (rows.results ?? []).map(mapThemeRow);
  return c.json({
    themes,
    cursor: themes.length === limit ? themes[themes.length - 1].fingerprint : null,
  });
});

app.route('/', api);

export default app;

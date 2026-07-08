type D1PreparedStatement = {
  bind: (...values: unknown[]) => D1PreparedStatement;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  all: <T = Record<string, unknown>>() => Promise<{ results?: T[] }>;
  run: () => Promise<unknown>;
};

type D1Database = {
  prepare: (query: string) => D1PreparedStatement;
  batch: (statements: D1PreparedStatement[]) => Promise<unknown[]>;
};

type Env = {
  FOLIA_SYNC_DB: D1Database;
  SYNC_TOKEN: string;
};

// docs/sync/cloudflare-d1-worker/src/index.ts
// Minimal user-hosted Worker for Folia Sync API backed by Cloudflare D1.

const SCHEMA_VERSION = 1;
const THEME_BUCKET_COUNT = 256;
const MAX_THEME_BATCH_SIZE = 500;
const MAX_THEME_BUCKET_REQUEST_SIZE = 32;
const DEFAULT_THEME_LIST_LIMIT = 500;
const MAX_THEME_LIST_LIMIT = 1000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    ...corsHeaders,
    'Content-Type': 'application/json; charset=utf-8',
  },
});

const nowIso = () => new Date().toISOString();

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

const isAuthorized = (request: Request, env: Env) => {
  const expected = `Bearer ${env.SYNC_TOKEN}`;
  return Boolean(env.SYNC_TOKEN) && request.headers.get('Authorization') === expected;
};

const readBody = async <T,>(request: Request): Promise<T | null> => {
  try {
    return await request.json() as T;
  } catch {
    return null;
  }
};

let schemaEnsured = false;

const ensureSchema = async (db: D1Database) => {
  if (schemaEnsured) {
    return;
  }

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

  return {
    fingerprint: value.fingerprint,
    theme: value.theme,
    updatedAt: value.updatedAt,
    source,
  };
};

const mapThemeRow = (row: { fingerprint: string; theme_json: string; source: string; updated_at: string }) => ({
  fingerprint: row.fingerprint,
  theme: JSON.parse(row.theme_json),
  source: row.source,
  updatedAt: row.updated_at,
});

const buildThemeBucketSummary = (
  bucketId: number,
  rows: Array<{ fingerprint: string; updated_at: string }>,
) => {
  const tokens = rows
    .map(row => `${row.fingerprint}\u0000${row.updated_at}`)
    .sort();
  const updatedAt = rows.reduce<string | null>((latest, row) => (
    !latest || Date.parse(row.updated_at) > Date.parse(latest) ? row.updated_at : latest
  ), null);

  return {
    bucketId,
    count: rows.length,
    hash: tokens.length > 0 ? String(hashSyncString(tokens.join('\u0001'))) : '0',
    updatedAt,
  };
};

const refreshThemeBuckets = async (db: D1Database, bucketIds: number[]) => {
  const uniqueBucketIds = Array.from(new Set(bucketIds.filter(bucketId => (
    Number.isInteger(bucketId) && bucketId >= 0 && bucketId < THEME_BUCKET_COUNT
  ))));
  if (uniqueBucketIds.length === 0) {
    return;
  }

  const summaries = await Promise.all(
    uniqueBucketIds.map(async (bucketId) => {
      const rows = await db
        .prepare('SELECT fingerprint, updated_at FROM themes WHERE bucket_id = ?')
        .bind(bucketId)
        .all<{ fingerprint: string; updated_at: string }>();
      return buildThemeBucketSummary(bucketId, rows.results ?? []);
    }),
  );

  await db.batch(summaries.map(summary => db
    .prepare(`
      INSERT INTO theme_buckets (bucket_id, count, hash, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(bucket_id) DO UPDATE SET
        count = excluded.count,
        hash = excluded.hash,
        updated_at = excluded.updated_at
    `)
    .bind(summary.bucketId, summary.count, summary.hash, summary.updatedAt)));
};

const getThemeManifest = async (db: D1Database) => {
  const rows = await db
    .prepare('SELECT bucket_id, count, hash, updated_at FROM theme_buckets')
    .all<{ bucket_id: number; count: number; hash: string; updated_at: string | null }>();
  const buckets = Array.from({ length: THEME_BUCKET_COUNT }, (_, bucketId) => ({
    bucketId,
    count: 0,
    hash: '0',
    updatedAt: null as string | null,
  }));

  (rows.results ?? []).forEach((row) => {
    if (Number.isInteger(row.bucket_id) && row.bucket_id >= 0 && row.bucket_id < THEME_BUCKET_COUNT) {
      buckets[row.bucket_id] = {
        bucketId: row.bucket_id,
        count: Number(row.count),
        hash: row.hash,
        updatedAt: row.updated_at,
      };
    }
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    bucketCount: THEME_BUCKET_COUNT,
    buckets,
  };
};

const handleRequest = async (request: Request, env: Env) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (!isAuthorized(request, env)) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  await ensureSchema(env.FOLIA_SYNC_DB);

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (request.method === 'GET' && path === '/health') {
    return json({ ok: true, schemaVersion: SCHEMA_VERSION, backend: 'cloudflare-d1' });
  }

  if (request.method === 'GET' && path === '/state') {
    const settingsRow = await env.FOLIA_SYNC_DB
      .prepare('SELECT updated_at FROM settings WHERE key = ?')
      .bind('visual')
      .first<{ updated_at: string }>();
    const themesRow = await env.FOLIA_SYNC_DB
      .prepare('SELECT MAX(updated_at) AS themesUpdatedAt, COUNT(*) AS themeCount FROM themes')
      .first<{ themesUpdatedAt: string | null; themeCount: number }>();
    return json({
      schemaVersion: SCHEMA_VERSION,
      settingsUpdatedAt: settingsRow?.updated_at ?? null,
      themesUpdatedAt: themesRow?.themesUpdatedAt ?? null,
      themeCount: Number(themesRow?.themeCount ?? 0),
    });
  }

  if (request.method === 'GET' && path === '/settings') {
    const row = await env.FOLIA_SYNC_DB
      .prepare('SELECT value_json FROM settings WHERE key = ?')
      .bind('visual')
      .first<{ value_json: string }>();
    return json(row ? JSON.parse(row.value_json) : null);
  }

  if (request.method === 'GET' && path === '/themes/manifest') {
    return json(await getThemeManifest(env.FOLIA_SYNC_DB));
  }

  if (request.method === 'PUT' && path === '/settings') {
    const body = await readBody<Record<string, unknown>>(request);
    if (!body || body.schemaVersion !== SCHEMA_VERSION || typeof body.updatedAt !== 'string' || !isRecord(body.data)) {
      return json({ ok: false, error: 'invalid_settings' }, 400);
    }

    await env.FOLIA_SYNC_DB
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
    return json({ ok: true });
  }

  if (request.method === 'POST' && path === '/themes/get') {
    const body = await readBody<{ fingerprints?: unknown[] }>(request);
    const fingerprints = Array.from(new Set((body?.fingerprints ?? []).filter((value): value is string => (
      typeof value === 'string' && Boolean(value)
    )))).slice(0, MAX_THEME_BATCH_SIZE);
    if (fingerprints.length === 0) {
      return json({ themes: [] });
    }

    const placeholders = fingerprints.map(() => '?').join(',');
    const rows = await env.FOLIA_SYNC_DB
      .prepare(`SELECT fingerprint, theme_json, source, updated_at FROM themes WHERE fingerprint IN (${placeholders})`)
      .bind(...fingerprints)
      .all<{ fingerprint: string; theme_json: string; source: string; updated_at: string }>();
    return json({ themes: (rows.results ?? []).map(mapThemeRow) });
  }

  if (request.method === 'POST' && path === '/themes/put') {
    const body = await readBody<{ themes?: unknown[] }>(request);
    const themes = (body?.themes ?? []).map(parseThemeInput);
    if (themes.some(theme => !theme) || themes.length > MAX_THEME_BATCH_SIZE) {
      return json({ ok: false, error: 'invalid_themes' }, 400);
    }

    await env.FOLIA_SYNC_DB.batch(themes.map(theme => env.FOLIA_SYNC_DB
      .prepare(`
        INSERT INTO themes (fingerprint, bucket_id, theme_json, source, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(fingerprint) DO UPDATE SET
          bucket_id = excluded.bucket_id,
          theme_json = excluded.theme_json,
          source = excluded.source,
          updated_at = excluded.updated_at
        WHERE excluded.updated_at >= themes.updated_at
      `)
      .bind(
        theme!.fingerprint,
        getThemeBucketId(theme!.fingerprint),
        JSON.stringify(theme!.theme),
        theme!.source,
        theme!.updatedAt,
      )));
    await refreshThemeBuckets(env.FOLIA_SYNC_DB, themes.map(theme => getThemeBucketId(theme!.fingerprint)));
    return json({ ok: true, savedCount: themes.length });
  }

  if (request.method === 'POST' && path === '/themes/bucket') {
    const body = await readBody<{ bucketIds?: unknown[] }>(request);
    const bucketIds = Array.from(new Set((body?.bucketIds ?? []).filter((value): value is number => (
      typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < THEME_BUCKET_COUNT
    )))).slice(0, MAX_THEME_BUCKET_REQUEST_SIZE);
    if (bucketIds.length === 0) {
      return json({ themes: [] });
    }

    const placeholders = bucketIds.map(() => '?').join(',');
    const rows = await env.FOLIA_SYNC_DB
      .prepare(`
        SELECT fingerprint, theme_json, source, updated_at
        FROM themes
        WHERE bucket_id IN (${placeholders})
        ORDER BY fingerprint ASC
      `)
      .bind(...bucketIds)
      .all<{ fingerprint: string; theme_json: string; source: string; updated_at: string }>();
    return json({ themes: (rows.results ?? []).map(mapThemeRow) });
  }

  if (request.method === 'POST' && path === '/themes/list') {
    const body = await readBody<{ cursor?: unknown; limit?: unknown }>(request);
    const cursor = typeof body?.cursor === 'string' ? body.cursor : '';
    const requestedLimit = typeof body?.limit === 'number' && Number.isFinite(body.limit)
      ? Math.trunc(body.limit)
      : DEFAULT_THEME_LIST_LIMIT;
    const limit = Math.max(1, Math.min(MAX_THEME_LIST_LIMIT, requestedLimit));
    const rows = await env.FOLIA_SYNC_DB
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
    return json({
      themes,
      cursor: themes.length === limit ? themes[themes.length - 1].fingerprint : null,
    });
  }

  return json({ ok: false, error: 'not_found' }, 404);
};

export default {
  fetch: handleRequest,
};

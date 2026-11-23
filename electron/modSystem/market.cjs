// electron/modSystem/market.cjs
// The mod market inside the app: reads the catalog the folium-compound site publishes (catalog.json), the
// README files it copies next to it, and installs or updates a mod from it. Everything it fetches comes from
// the market's own origin; the window only ever names a mod id, never a URL or a path. A downloaded package
// is checked against the catalog (size, SHA-256) and then handed to the zip installer with what the catalog
// says it is: the installer refuses it unless its signature, made with a key this app trusts for that
// channel, covers exactly those files (zipInstall.cjs `expect`). So the catalog is a list, not a trust root.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const shared = require('./foliumShared.json');
const { INSTALL_LIMITS } = require('./zipInstall.cjs');

const CATALOG_FORMAT = 'folium-market-catalog';
const AWESOME_KINDS = new Set(['source', 'plugin', 'app', 'tool', 'other']);
const MOD_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

// The site answers with max-age=300; the catalog is read again after this unless asked to.
const CATALOG_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15 * 1000;
const DOWNLOAD_TIMEOUT_MS = 3 * 60 * 1000;
const CATALOG_MAX_BYTES = 8 * 1024 * 1024;
const README_MAX_BYTES = 256 * 1024;
const TEXT_LIMITS = { name: 120, author: 120, description: 2000, short: 200 };

/*
 * The market origin: the folium-compound site of foliumShared.json. A development build may point it at a
 * local copy of the site (`FOLIA_MOD_MARKET_ORIGIN=http://localhost:4173`); a packaged app never reads that.
 */
const resolveMarketOrigin = ({ isPackaged, env = process.env }) => {
    const fallback = shared.market.origin;
    const asked = !isPackaged && typeof env.FOLIA_MOD_MARKET_ORIGIN === 'string' ? env.FOLIA_MOD_MARKET_ORIGIN.trim() : '';
    if (!asked) return fallback;
    try {
        const url = new URL(asked);
        return (url.protocol === 'https:' || url.protocol === 'http:') ? url.origin : fallback;
    } catch {
        return fallback;
    }
};

const text = (value, limit) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : null);
const stringList = (value, limit = 64) => (Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.length > 0 && item.length <= TEXT_LIMITS.short).slice(0, limit)
    : []);

// An https link without credentials, or null.
const httpsLink = (value) => {
    if (typeof value !== 'string' || value.length > 512) return null;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
    } catch {
        return null;
    }
};

// A path the site serves under `prefix`, resolved against its origin; anything else is null.
const marketLink = (value, origin, prefix) => {
    if (typeof value !== 'string' || value.length > 512) return null;
    try {
        const url = new URL(value, origin);
        return url.origin === origin && url.pathname.startsWith(prefix) && !url.pathname.includes('..') ? url.href : null;
    } catch {
        return null;
    }
};

/*
 * Where a source repository takes its issues, for the forges that have one place for them; null otherwise.
 * `https://github.com/me/mod(.git)` gives `https://github.com/me/mod/issues`.
 */
const ISSUE_PATHS = { 'github.com': '/issues', 'codeberg.org': '/issues', 'gitlab.com': '/-/issues' };
const issuesUrlOf = (repository) => {
    const link = httpsLink(repository);
    if (!link) return null;
    const url = new URL(link);
    const suffix = ISSUE_PATHS[url.hostname.toLowerCase()];
    const parts = url.pathname.split('/').filter(Boolean);
    if (!suffix || parts.length < 2) return null;
    return `${url.origin}/${parts[0]}/${parts[1].replace(/\.git$/i, '')}${suffix}`;
};

// Where to take a mod's problems by its manifest (Folium 2.1 `bugs`, `repository`); the window adds the catalog.
const feedbackUrlOf = (manifest) => (
    httpsLink(manifest?.bugs) ?? issuesUrlOf(manifest?.repository) ?? httpsLink(manifest?.repository) ?? null
);

// An owner as the catalog lists it: a name, or `{ login, url }`.
const ownerOf = (value) => {
    if (typeof value === 'string') return text(value, TEXT_LIMITS.short) ? { login: value.trim(), url: null } : null;
    if (value && typeof value === 'object' && text(value.login, TEXT_LIMITS.short)) {
        return { login: value.login.trim(), url: httpsLink(value.url) };
    }
    return null;
};

/* One mod of the catalog, or null when it cannot be offered (no id, no version, no package to check). */
const normalizeModEntry = (entry, origin) => {
    if (!entry || typeof entry !== 'object') return null;
    const id = typeof entry.id === 'string' && MOD_ID_PATTERN.test(entry.id) ? entry.id : null;
    const version = typeof entry.version === 'string' && VERSION_PATTERN.test(entry.version) ? entry.version : null;
    const downloadUrl = marketLink(entry.download?.url, origin, '/downloads/');
    const sha256 = typeof entry.download?.sha256 === 'string' && SHA256_PATTERN.test(entry.download.sha256) ? entry.download.sha256 : null;
    const digest = typeof entry.digest === 'string' && DIGEST_PATTERN.test(entry.digest) ? entry.digest : null;
    if (!id || !version || !downloadUrl || !sha256 || !digest) return null;
    const size = Number(entry.download?.size);
    const previewUrl = marketLink(entry.preview?.url, origin, '/previews/');
    const source = httpsLink(entry.source);
    const repository = httpsLink(entry.repository) ?? source;
    return {
        id,
        name: text(entry.name, TEXT_LIMITS.name) ?? id,
        version,
        author: text(entry.author, TEXT_LIMITS.author),
        description: text(entry.description, TEXT_LIMITS.description),
        origin: entry.origin === 'official' ? 'official' : 'community',
        channel: entry.channel === 'beta' ? 'beta' : 'release',
        kind: entry.kind === 'source' ? 'source' : 'standard',
        category: text(entry.category, 40),
        tags: stringList(entry.tags, 24),
        permissions: stringList(entry.permissions),
        experimental: stringList(entry.experimental),
        embedOrigins: stringList(entry.embedOrigins),
        depends: stringList(entry.depends),
        folia: text(entry.folia, 80),
        hasMain: entry.hasMain === true,
        owners: (Array.isArray(entry.owners) ? entry.owners : []).map(ownerOf).filter(Boolean).slice(0, 16),
        source,
        repository,
        bugs: httpsLink(entry.bugs) ?? issuesUrlOf(repository),
        readmeUrl: marketLink(entry.readme, origin, '/readmes/'),
        keyLabel: text(entry.keyLabel, TEXT_LIMITS.short),
        keyId: text(entry.keyId, TEXT_LIMITS.short),
        signedAt: text(entry.signedAt, 40),
        addedAt: text(entry.addedAt, 40),
        updatedAt: text(entry.updatedAt, 40) ?? text(entry.signedAt, 40),
        digest,
        download: { url: downloadUrl, sha256, size: Number.isFinite(size) && size > 0 ? size : null },
        preview: previewUrl ? {
            url: previewUrl,
            width: Number(entry.preview.width) || null,
            height: Number(entry.preview.height) || null,
        } : null,
        page: `${origin}/#mod-${id}`,
    };
};

/* One Awesome-Folia entry: a work kept elsewhere, offered as a link only. */
const normalizeAwesomeEntry = (entry) => {
    if (!entry || typeof entry !== 'object') return null;
    const id = typeof entry.id === 'string' && MOD_ID_PATTERN.test(entry.id) ? entry.id : null;
    const url = httpsLink(entry.url);
    if (!id || !url) return null;
    return {
        id,
        name: text(entry.name, TEXT_LIMITS.name) ?? id,
        kind: AWESOME_KINDS.has(entry.kind) ? entry.kind : 'other',
        category: text(entry.category, 40),
        description: text(entry.description, TEXT_LIMITS.description),
        url,
        homepage: httpsLink(entry.homepage),
        bugs: httpsLink(entry.bugs) ?? issuesUrlOf(url),
        owners: (Array.isArray(entry.owners) ? entry.owners : []).map(ownerOf).filter(Boolean).slice(0, 16),
        tags: stringList(entry.tags, 24),
        addedAt: text(entry.addedAt, 40),
        updatedAt: text(entry.updatedAt, 40) ?? text(entry.addedAt, 40),
    };
};

const normalizeCategory = (entry) => {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(entry.id)) return null;
    const label = entry.label && typeof entry.label === 'object' ? entry.label : {};
    return {
        id: entry.id,
        label: {
            'zh-CN': text(label['zh-CN'] ?? label.zh, 40) ?? entry.id,
            en: text(label.en, 40) ?? entry.id,
        },
    };
};

/* A catalog as the window gets it (format version 2 or 3; 3 adds categories, tags, README links and awesome). */
const normalizeCatalog = (raw, origin) => {
    if (!raw || typeof raw !== 'object' || raw.format !== CATALOG_FORMAT || !Array.isArray(raw.mods)) return null;
    const seen = new Set();
    const mods = raw.mods.map((entry) => normalizeModEntry(entry, origin)).filter((entry) => {
        if (!entry || seen.has(entry.id)) return false;
        seen.add(entry.id);
        return true;
    });
    const awesomeSeen = new Set();
    const awesome = (Array.isArray(raw.awesome) ? raw.awesome : []).map(normalizeAwesomeEntry).filter((entry) => {
        if (!entry || awesomeSeen.has(entry.id)) return false;
        awesomeSeen.add(entry.id);
        return true;
    });
    return {
        version: Number(raw.version) || null,
        commit: text(raw.commit, 64),
        origin,
        categories: (Array.isArray(raw.categories) ? raw.categories : []).map(normalizeCategory).filter(Boolean),
        mods,
        awesome,
    };
};

const sha256Of = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

/*
 * `fetchImpl(url, init)` is Electron's net.fetch (the app's network stack: system proxy, certificates);
 * `installModFromZip(path, { expect })` the zip installer's; `cacheDir` where the catalog, README files and
 * downloads are kept (userData/mod-market); `onProgress` hears one install's progress.
 */
const createModMarket = ({ origin, cacheDir, fetchImpl, installModFromZip, onProgress = () => {} }) => {
    let memory = null; // { raw, catalog, etag, fetchedAt }
    let catalogLoad = null;
    let installQueue = Promise.resolve();

    const catalogFile = () => path.join(cacheDir, 'catalog.json');

    const writeAtomic = (file, data) => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const temporary = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(temporary, data);
        fs.renameSync(temporary, file);
    };

    const readCached = () => {
        if (memory) return memory;
        try {
            const stored = JSON.parse(fs.readFileSync(catalogFile(), 'utf8'));
            if (stored?.origin !== origin) return null;
            const catalog = normalizeCatalog(stored.raw, origin);
            if (!catalog) return null;
            memory = { raw: stored.raw, catalog, etag: typeof stored.etag === 'string' ? stored.etag : null, fetchedAt: Number(stored.fetchedAt) || 0 };
            return memory;
        } catch {
            return null;
        }
    };

    // Reads a response body up to `maxBytes`, telling `onBytes` how far it got.
    const readBody = async (response, maxBytes, onBytes = null) => {
        const declared = Number(response.headers.get('content-length'));
        if (Number.isFinite(declared) && declared > maxBytes) throw new Error('market-too-large');
        if (!response.body || typeof response.body.getReader !== 'function') {
            const buffer = Buffer.from(await response.arrayBuffer());
            if (buffer.length > maxBytes) throw new Error('market-too-large');
            return buffer;
        }
        const reader = response.body.getReader();
        const chunks = [];
        let received = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            received += value.byteLength;
            if (received > maxBytes) {
                reader.cancel().catch(() => undefined);
                throw new Error('market-too-large');
            }
            chunks.push(Buffer.from(value));
            if (onBytes) onBytes(received, Number.isFinite(declared) ? declared : null);
        }
        return Buffer.concat(chunks);
    };

    const request = async (url, { headers = {}, timeoutMs = FETCH_TIMEOUT_MS } = {}) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            return { response: await fetchImpl(url, { headers, signal: controller.signal, cache: 'no-store', redirect: 'error' }), timer };
        } catch (error) {
            clearTimeout(timer);
            throw new Error(controller.signal.aborted ? 'market-timeout' : `market-offline:${error?.message ?? error}`, { cause: error });
        }
    };

    const fetchCatalog = async () => {
        const cached = readCached();
        const { response, timer } = await request(`${origin}/catalog.json`, {
            headers: cached?.etag ? { 'if-none-match': cached.etag } : {},
        });
        try {
            if (response.status === 304 && cached) {
                memory = { ...cached, fetchedAt: Date.now() };
                writeAtomic(catalogFile(), JSON.stringify({ origin, raw: cached.raw, etag: cached.etag, fetchedAt: memory.fetchedAt }));
                return memory;
            }
            if (!response.ok) throw new Error(`market-http:${response.status}`);
            const raw = JSON.parse((await readBody(response, CATALOG_MAX_BYTES)).toString('utf8'));
            const catalog = normalizeCatalog(raw, origin);
            if (!catalog) throw new Error('market-catalog-format');
            memory = { raw, catalog, etag: response.headers.get('etag'), fetchedAt: Date.now() };
            writeAtomic(catalogFile(), JSON.stringify({ origin, raw, etag: memory.etag, fetchedAt: memory.fetchedAt }));
            console.info(`[ModMarket] catalog read: ${catalog.mods.length} mods, ${catalog.awesome.length} awesome entries (format ${catalog.version ?? '?'})`);
            return memory;
        } finally {
            clearTimeout(timer);
        }
    };

    /*
     * The catalog: the one in memory or on disk while it is fresh, else the site's. Offline (or the site
     * answering something else) it is the last one read, marked `stale`, with the reason.
     */
    const getCatalog = async ({ force = false } = {}) => {
        const cached = readCached();
        if (!force && cached && Date.now() - cached.fetchedAt < CATALOG_TTL_MS) {
            return { ok: true, catalog: cached.catalog, fetchedAt: cached.fetchedAt, stale: false };
        }
        if (!catalogLoad) {
            catalogLoad = fetchCatalog().finally(() => { catalogLoad = null; });
        }
        try {
            const fresh = await catalogLoad;
            return { ok: true, catalog: fresh.catalog, fetchedAt: fresh.fetchedAt, stale: false };
        } catch (error) {
            const reason = error?.message ?? String(error);
            console.warn('[ModMarket] catalog could not be read', error);
            const fallback = readCached();
            return fallback
                ? { ok: true, catalog: fallback.catalog, fetchedAt: fallback.fetchedAt, stale: true, error: reason }
                : { ok: false, error: reason };
        }
    };

    /* A mod's README as text, from the catalog's link (the site's /readmes/ only). */
    const getReadme = async (url) => {
        const link = marketLink(url, origin, '/readmes/');
        if (!link) return { ok: false, error: 'market-readme-url' };
        const file = path.join(cacheDir, 'readmes', `${crypto.createHash('sha1').update(link).digest('hex')}.md`);
        try {
            return { ok: true, text: fs.readFileSync(file, 'utf8') };
        } catch {
            // Not kept yet: read it. The file name carries the mod version, so a kept copy never goes stale.
        }
        try {
            const { response, timer } = await request(link);
            try {
                if (!response.ok) return { ok: false, error: `market-http:${response.status}` };
                const body = (await readBody(response, README_MAX_BYTES)).toString('utf8');
                writeAtomic(file, body);
                return { ok: true, text: body };
            } finally {
                clearTimeout(timer);
            }
        } catch (error) {
            return { ok: false, error: error?.message ?? String(error) };
        }
    };

    /*
     * Installs (or updates to) the catalog's version of `modId`. One at a time: each install reloads the mods.
     * The answer is the installer's (`{ ok, id, mods }` or `{ ok: false, error }`).
     */
    const installNow = async (modId) => {
        const progress = (phase, extra = {}) => onProgress({ id: modId, phase, ...extra });
        const current = await getCatalog();
        const entry = current.ok ? current.catalog.mods.find((mod) => mod.id === modId) : null;
        if (!entry) {
            progress('error', { error: 'market-mod-not-found' });
            return { ok: false, error: 'market-mod-not-found' };
        }
        const packages = path.join(cacheDir, 'packages');
        const zipPath = path.join(packages, `${entry.id}-${entry.version}.zip`);
        try {
            fs.mkdirSync(packages, { recursive: true });
            progress('download', { received: 0, total: entry.download.size });
            const { response, timer } = await request(entry.download.url, { timeoutMs: DOWNLOAD_TIMEOUT_MS });
            let buffer;
            try {
                if (!response.ok) throw new Error(`market-http:${response.status}`);
                buffer = await readBody(response, INSTALL_LIMITS.maxArchiveBytes, (received, total) => {
                    progress('download', { received, total: total ?? entry.download.size });
                });
            } finally {
                clearTimeout(timer);
            }
            progress('verify');
            if (sha256Of(buffer) !== entry.download.sha256) throw new Error('market-checksum-mismatch');
            writeAtomic(zipPath, buffer);
            progress('install');
            const result = await installModFromZip(zipPath, {
                expect: { id: entry.id, version: entry.version, digest: entry.digest, channel: entry.channel },
            });
            progress(result.ok ? 'done' : 'error', result.ok ? {} : { error: result.error });
            console.info(`[ModMarket] ${entry.id}@${entry.version}: ${result.ok ? 'installed' : `not installed (${result.error})`}`);
            return result;
        } catch (error) {
            const reason = error?.message ?? String(error);
            console.warn(`[ModMarket] ${modId}: install failed`, error);
            progress('error', { error: reason });
            return { ok: false, error: reason };
        } finally {
            fs.rmSync(zipPath, { force: true });
        }
    };

    const install = (modId) => {
        if (typeof modId !== 'string' || !MOD_ID_PATTERN.test(modId)) {
            return Promise.resolve({ ok: false, error: 'market-mod-not-found' });
        }
        const run = () => installNow(modId);
        const next = installQueue.then(run, run);
        installQueue = next.catch(() => undefined);
        return next;
    };

    return { getCatalog, getReadme, install };
};

module.exports = {
    CATALOG_FORMAT,
    createModMarket,
    feedbackUrlOf,
    issuesUrlOf,
    normalizeCatalog,
    resolveMarketOrigin,
};

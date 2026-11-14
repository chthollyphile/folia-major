// electron/modSystem/mediaRules.cjs
// The media cross-origin rules source mods register with `api.media.allow` (Folium 2.0 plan §5.5). A session
// has one `webRequest.onHeadersReceived` listener, so the host keeps it (main.cjs setupCorsBypassHandlers)
// and asks `allows(details)` here; no mod hooks webRequest itself. A rule names hosts (`example.com`, or
// `*.example.com` for the domain and every subdomain) and/or exact URLs the source issued, each with an
// optional lifetime; a URL rule can follow redirects (the CDN hop of an issued audio URL). A rule may also hand a
// `test(request)` of its own, for what hosts cannot say (a path that ends in an audio extension, an answer's
// content type): it is asked after the rule's URLs and hosts, synchronously, with { url, method, resourceType,
// responseHeaders }, and a test that throws counts as no. Only reads (GET, HEAD, OPTIONS) of media, images and
// fetches get the headers, as with the built-in policies.

'use strict';

const MAX_URLS_PER_MOD = 2048;
const DEFAULT_RESOURCE_TYPES = Object.freeze(['media', 'xhr', 'image']);
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const HOST_PATTERN = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/* An http(s) URL without credentials or fragment, as a string; null for anything else. */
const normalizeUrl = (value) => {
    try {
        const url = new URL(String(value));
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
        url.hash = '';
        return url.href;
    } catch {
        return null;
    }
};

const hostMatches = (pattern, hostname) => (
    pattern.startsWith('*.')
        ? hostname === pattern.slice(2) || hostname.endsWith(pattern.slice(1))
        : hostname === pattern
);

/** `now` is for tests. */
const createMediaRules = ({ now = Date.now } = {}) => {
    // modId -> Set of rules; a rule: { hosts, test, urls: Map href -> expiry, ttlMs, followRedirects, resourceTypes }
    const rulesByMod = new Map();

    /*
     * Registers one rule for `modId` and returns the function that removes it. Throws on a rule it cannot
     * read, at the mod's call. `rule.add(url)` (on the returned function) adds an issued URL to it later.
     */
    const allow = (modId, rule) => {
        if (!rule || typeof rule !== 'object') throw new TypeError('media.allow requires a rule object');
        const hosts = rule.hosts === undefined ? [] : rule.hosts;
        if (!Array.isArray(hosts) || !hosts.every((host) => typeof host === 'string' && HOST_PATTERN.test(host))) {
            throw new TypeError('media.allow: hosts must be host names, or "*.domain"');
        }
        const resourceTypes = rule.resourceTypes === undefined ? DEFAULT_RESOURCE_TYPES : rule.resourceTypes;
        if (!Array.isArray(resourceTypes) || !resourceTypes.every((type) => typeof type === 'string')) {
            throw new TypeError('media.allow: resourceTypes must be a list of strings');
        }
        const ttlMs = rule.ttlMs === undefined || rule.ttlMs === null ? null : Number(rule.ttlMs);
        if (ttlMs !== null && !(ttlMs > 0)) throw new TypeError('media.allow: ttlMs must be a positive number');
        if (rule.test !== undefined && typeof rule.test !== 'function') throw new TypeError('media.allow: test must be a function');
        const entry = {
            hosts: [...hosts],
            test: rule.test ?? null,
            urls: new Map(),
            ttlMs,
            followRedirects: rule.followRedirects === true,
            resourceTypes: new Set(resourceTypes),
        };
        const addUrl = (value) => {
            const href = normalizeUrl(value);
            if (!href) return false;
            entry.urls.delete(href);
            entry.urls.set(href, ttlMs === null ? Infinity : now() + ttlMs);
            while (entry.urls.size > MAX_URLS_PER_MOD) entry.urls.delete(entry.urls.keys().next().value);
            return true;
        };
        (rule.urls ?? []).forEach(addUrl);
        const rules = rulesByMod.get(modId) ?? new Set();
        rulesByMod.set(modId, rules);
        rules.add(entry);
        const remove = () => {
            rules.delete(entry);
            if (rules.size === 0 && rulesByMod.get(modId) === rules) rulesByMod.delete(modId);
        };
        remove.add = addUrl;
        return remove;
    };

    /* What a rule's `test` is asked: the request's own fields, not Electron's whole details object. */
    const requestOf = (details) => Object.freeze({
        url: String(details.url),
        method: String(details.method ?? 'GET').toUpperCase(),
        resourceType: details.resourceType,
        responseHeaders: details.responseHeaders ?? {},
    });

    const passesTest = (entry, details) => {
        try {
            return entry.test(requestOf(details)) === true;
        } catch {
            return false;
        }
    };

    /* The first rule that lets `details` (a webRequest details object) through, or null. */
    const matching = (details) => {
        if (!READ_METHODS.has(String(details?.method ?? 'GET').toUpperCase())) return null;
        const href = normalizeUrl(details?.url);
        if (!href) return null;
        const { hostname } = new URL(href);
        const time = now();
        for (const rules of rulesByMod.values()) {
            for (const entry of rules) {
                if (details.resourceType && !entry.resourceTypes.has(details.resourceType)) continue;
                const expiry = entry.urls.get(href);
                if (expiry !== undefined) {
                    if (expiry > time) return entry;
                    entry.urls.delete(href);
                }
                if (entry.hosts.some((pattern) => hostMatches(pattern, hostname))) return entry;
                if (entry.test && passesTest(entry, details)) return entry;
            }
        }
        return null;
    };

    return {
        allow,
        allows: (details) => matching(details) !== null,
        /*
         * onBeforeRedirect: a rule that follows redirects also covers where a request it let through went: a URL of
         * the rule's keeps its expiry, one its `test` let through gets the rule's lifetime. Hosts alone never follow.
         */
        followRedirect: (details) => {
            const entry = matching(details);
            if (!entry?.followRedirects) return;
            const from = normalizeUrl(details.url);
            const expiry = entry.urls.get(from);
            const viaTest = expiry === undefined && entry.test !== null && passesTest(entry, details);
            if (expiry === undefined && !viaTest) return;
            const href = normalizeUrl(details.redirectURL);
            if (!href) return;
            entry.urls.delete(href);
            entry.urls.set(href, viaTest ? (entry.ttlMs === null ? Infinity : now() + entry.ttlMs) : expiry);
            while (entry.urls.size > MAX_URLS_PER_MOD) entry.urls.delete(entry.urls.keys().next().value);
        },
        /* Every rule of `modId` goes: the mod stopped. */
        removeMod: (modId) => {
            rulesByMod.delete(modId);
        },
        size: () => Array.from(rulesByMod.values()).reduce((total, rules) => total + rules.size, 0),
    };
};

module.exports = { createMediaRules };

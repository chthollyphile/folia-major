// electron/modSystem/manifest.cjs
// Pure helpers for validating Folium manifests and resolving the mod dependency graph.
// No side effects on import so the logic stays unit-testable from test/unit/mod-system/.

'use strict';

// The version and the names below are written once, in foliumShared.json, which
// the window side reads too (src/mods/folium/shared.ts).
const shared = require('./foliumShared.json');
const { readOldManifest } = require('./deprecated.cjs');

/*
 * Folium platform version. `major` is what a manifest declares (`"folium": 1`);
 * `minor` grows with every additive change inside 1.x and is shown to mods at
 * runtime (`api.host.folium`, `folium.host.folium`).
 */
const FOLIUM_VERSION = Object.freeze({ major: shared.version.major, minor: shared.version.minor });

// The permission ids a mod can declare (the keys of foliumShared.json's
// permissions, each with the members it guards). Anything else is rejected at
// validation time so a mod can never claim a capability the loader does not
// implement (fail closed). Permissions are a declaration shown in the trust
// dialog, not a sandbox.
const KNOWN_PERMISSIONS = new Set(Object.keys(shared.permissions));

/*
 * The permission a gate checks for one member, e.g. permissionGuarding('api.storage') is
 * 'filesystem.data': the permission whose `guards` in foliumShared.json list that member. Throws when
 * the gate's file loads if none does, so the gate and the list cannot disagree.
 */
const permissionGuarding = (member) => {
    const id = Object.keys(shared.permissions).find((key) => shared.permissions[key].guards.includes(member));
    if (id === undefined) {
        throw new Error(`no Folium permission guards "${member}" in foliumShared.json`);
    }
    return id;
};

// embedOrigins are only for folium.ui.embed, which this permission unlocks.
const NET_EMBED_PERMISSION = permissionGuarding('folium.ui.embed');

// Unfrozen surfaces a mod must opt into explicitly; they may change in any minor.
const KNOWN_EXPERIMENTAL = new Set(Object.values(shared.experimental));

/*
 * Folium 1.7: the permissions of the experimental platform.raw, `platform.<id>.read` and
 * `platform.<id>.write` (one pair per platform that can be called through it, listed in
 * foliumShared.json). They unlock nothing without the opt-in, and writing goes with reading: a manifest
 * that declares one without the other is refused, so the trust dialog never shows a grant that does
 * not work.
 */
const PLATFORM_RAW_EXPERIMENTAL = shared.experimental.platformRaw;
const PLATFORM_PERMISSION = /^platform\.([^.]+)\.(read|write)$/;

const MOD_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

// Deterministic result envelope shared by all validators.
const ok = (value) => ({ ok: true, value });
const fail = (errors) => ({ ok: false, errors });

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

/*
 * Dependency strings in `depends` are either a bare mod id ("base-mod") or
 * "id@^1.2.3". Only the caret range and the wildcard are supported; unsupported
 * operators are reported as validation errors instead of being guessed.
 */
const parseDependency = (raw) => {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
        return { ok: false, error: `invalid dependency entry ${JSON.stringify(raw)}` };
    }
    const at = raw.lastIndexOf('@');
    if (at <= 0) {
        return { ok: true, id: raw.trim(), range: null };
    }
    const id = raw.slice(0, at).trim();
    const range = raw.slice(at + 1).trim();
    if (!MOD_ID_PATTERN.test(id)) {
        return { ok: false, error: `invalid dependency id in "${raw}"` };
    }
    if (range !== '*' && !/^\^[0-9]+\.[0-9]+\.[0-9]+$/.test(range)) {
        return { ok: false, error: `unsupported version range "${range}" in "${raw}"` };
    }
    return { ok: true, id, range };
};

const parseVersion = (version) => {
    const match = /^([0-9]+)\.([0-9]+)\.([0-9]+)$/.exec(String(version ?? '').trim());
    if (!match) {
        return null;
    }
    return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
};

const compareVersions = (left, right) => {
    if (left.major !== right.major) return left.major - right.major;
    if (left.minor !== right.minor) return left.minor - right.minor;
    return left.patch - right.patch;
};

const satisfiesRange = (version, range) => {
    if (!range || range === '*') {
        return true;
    }
    const parsed = parseVersion(version);
    if (!parsed) {
        return false;
    }
    if (range.startsWith('^')) {
        const min = parseVersion(range.slice(1));
        if (!min) {
            return false;
        }
        if (compareVersions(parsed, min) < 0) {
            return false;
        }
        // Caret range: same major version.
        return parsed.major === min.major;
    }
    return false;
};

/*
 * Host version ranges (`"folia"`): space-separated comparators that must all
 * hold, e.g. ">=0.7.0 <0.8.0". Supported operators: >=, >, <=, <, =, ^ and a
 * bare version (exact). "*" matches everything. Anything else is invalid.
 */
const HOST_COMPARATOR_PATTERN = /^(>=|>|<=|<|=|\^)?([0-9]+\.[0-9]+\.[0-9]+)$/;

const parseHostRange = (range) => {
    if (typeof range !== 'string' || range.trim().length === 0) {
        return null;
    }
    const trimmed = range.trim();
    if (trimmed === '*') {
        return [];
    }
    const comparators = [];
    for (const token of trimmed.split(/\s+/)) {
        const match = HOST_COMPARATOR_PATTERN.exec(token);
        if (!match) {
            return null;
        }
        comparators.push({ operator: match[1] ?? '=', version: parseVersion(match[2]) });
    }
    return comparators;
};

const satisfiesHostRange = (version, range) => {
    const comparators = parseHostRange(range);
    const parsed = parseVersion(version);
    if (!comparators || !parsed) {
        return false;
    }
    return comparators.every(({ operator, version: bound }) => {
        const order = compareVersions(parsed, bound);
        switch (operator) {
            case '>=': return order >= 0;
            case '>': return order > 0;
            case '<=': return order <= 0;
            case '<': return order < 0;
            case '^': return order >= 0 && parsed.major === bound.major;
            default: return order === 0;
        }
    });
};

// A relative path inside the mod directory: no traversal, no backslashes, no absolute paths.
const isSafeRelativePath = (value) => (
    isNonEmptyString(value)
    && !value.includes('..')
    && !value.includes('\\')
    && !value.startsWith('/')
    && !/^[a-zA-Z]:/.test(value)
);

/*
 * `embedOrigins` entries must be bare https origins ("https://host[:port]"),
 * exactly what `new URL(x).origin` returns, so the runtime check can compare
 * strings instead of re-parsing patterns.
 */
const isHttpsOrigin = (value) => {
    if (typeof value !== 'string') return false;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && url.origin === value;
    } catch {
        return false;
    }
};

const validateManifest = (raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return fail(['manifest root must be a JSON object']);
    }

    const errors = [];
    // The fields read here are all that mod.json can have.
    const manifest = {
        folium: raw.folium,
        id: raw.id,
        name: raw.name,
        version: raw.version,
        author: raw.author ?? null,
        description: raw.description ?? null,
        main: raw.main ?? null,
        client: raw.client ?? null,
        depends: Array.isArray(raw.depends) ? raw.depends : [],
        permissions: Array.isArray(raw.permissions) ? raw.permissions : [],
        experimental: Array.isArray(raw.experimental) ? raw.experimental : [],
        embedOrigins: Array.isArray(raw.embedOrigins) ? raw.embedOrigins : [],
        folia: raw.folia ?? null,
        preview: raw.preview ?? null,
    };
    // Folium 1.6 only (deprecated.cjs): an old permission id is read as its new one, and a field
    // mod.json does not have is a warning, not the error below.
    raw = readOldManifest(raw, manifest);
    // Any other field is an error naming it, so a misspelt one ("premissions") fails
    // loudly instead of being ignored.
    Object.keys(raw).forEach((field) => {
        if (!Object.hasOwn(manifest, field) && raw[field] !== undefined) {
            errors.push(`unknown field "${field}"; mod.json can have: ${Object.keys(manifest).join(', ')}`);
        }
    });

    if (manifest.folium !== FOLIUM_VERSION.major) {
        errors.push(`unsupported folium version ${JSON.stringify(manifest.folium)}; this host implements folium ${FOLIUM_VERSION.major}`);
    }
    if (!isNonEmptyString(manifest.id) || !MOD_ID_PATTERN.test(manifest.id)) {
        errors.push('mod.id is required and must match /^[a-z0-9][a-z0-9-]*$/');
    }
    if (!isNonEmptyString(manifest.name)) {
        errors.push('mod.name is required');
    }
    if (typeof manifest.name === 'string' && manifest.name.length > 64) {
        errors.push('mod.name is limited to 64 characters');
    }
    if (!parseVersion(manifest.version)) {
        errors.push('mod.version must be a semantic version like 1.2.3');
    }
    if (manifest.main === null && manifest.client === null) {
        errors.push('a mod needs at least one entry: "main" (Node) or "client" (renderer)');
    }
    if (manifest.main !== null && (!isNonEmptyString(manifest.main) || /[\\/]/.test(manifest.main) || !/\.c?js$/.test(manifest.main))) {
        errors.push('mod.main must be a single .cjs/.js file name inside the mod directory');
    }
    if (manifest.client !== null && (!isSafeRelativePath(manifest.client) || !/\.m?js$/.test(manifest.client))) {
        errors.push('mod.client must be a relative .mjs/.js path inside the mod directory');
    }
    // Introduction image (shown by the mod market): optional here, required there.
    if (manifest.preview !== null && (!isSafeRelativePath(manifest.preview) || !/\.(png|jpe?g|webp)$/i.test(manifest.preview))) {
        errors.push('mod.preview must be a relative .png/.jpg/.webp path inside the mod directory');
    }

    const dependencyIds = new Set();
    manifest.depends.forEach((dependency) => {
        const parsed = parseDependency(dependency);
        if (!parsed.ok) {
            errors.push(parsed.error);
            return;
        }
        if (dependencyIds.has(parsed.id)) {
            errors.push(`duplicate dependency "${parsed.id}"`);
        }
        dependencyIds.add(parsed.id);
    });

    const permissionIds = new Set();
    manifest.permissions.forEach((permission) => {
        if (typeof permission !== 'string' || !KNOWN_PERMISSIONS.has(permission)) {
            errors.push(`unknown or unsupported permission ${String(permission)}`);
            return;
        }
        if (permissionIds.has(permission)) {
            errors.push(`duplicate permission "${permission}"`);
        }
        permissionIds.add(permission);
    });

    manifest.experimental.forEach((feature) => {
        if (typeof feature !== 'string' || !KNOWN_EXPERIMENTAL.has(feature)) {
            errors.push(`unknown experimental feature ${String(feature)}`);
        }
    });

    permissionIds.forEach((permission) => {
        const platform = PLATFORM_PERMISSION.exec(permission);
        if (!platform) return;
        if (!manifest.experimental.includes(PLATFORM_RAW_EXPERIMENTAL)) {
            errors.push(`permission ${permission} needs "${PLATFORM_RAW_EXPERIMENTAL}" under experimental`);
        }
        if (platform[2] === 'write' && !permissionIds.has(`platform.${platform[1]}.read`)) {
            errors.push(`permission ${permission} needs platform.${platform[1]}.read as well`);
        }
    });

    manifest.embedOrigins.forEach((origin) => {
        if (!isHttpsOrigin(origin)) {
            errors.push(`embedOrigins entry ${JSON.stringify(origin)} must be a bare https origin like "https://example.com"`);
        }
    });
    if (manifest.embedOrigins.length > 0 && !permissionIds.has(NET_EMBED_PERMISSION)) {
        errors.push('embedOrigins requires the net.embed permission');
    }

    if (manifest.folia !== null && !parseHostRange(manifest.folia)) {
        errors.push(`mod.folia ${JSON.stringify(manifest.folia)} is not a supported version range (e.g. ">=0.7.0 <0.8.0")`);
    }

    return errors.length > 0 ? fail(errors) : ok(manifest);
};

/*
 * Scoped dependency resolution.
 * Input: Map<modId, manifest> plus the ids to resolve for (`roots`, defaults to
 * every manifest). Output: `{ order, failures }` where `order` lists the mods
 * that can be loaded, dependencies first, and `failures` maps a mod id to the
 * reasons it (or something it depends on) cannot load.
 *
 * Failures are confined to the subgraph that actually broke: one mod declaring
 * a missing dependency or forming a cycle can never invalidate unrelated mods.
 * `isEnabled`, when given, additionally refuses to resolve through a mod the
 * user has not enabled, so an enabled mod never runs against a dependency whose
 * code was never confirmed.
 */
const resolveLoadPlan = (manifests, { roots = null, source = 'unknown', isEnabled = null } = {}) => {
    const order = [];
    const failures = new Map();
    // modId -> 'visiting' | 'ok' | 'failed'
    const state = new Map();

    const addFailure = (modId, message) => {
        const existing = failures.get(modId);
        if (!existing) {
            failures.set(modId, [message]);
            return;
        }
        if (!existing.includes(message)) {
            existing.push(message);
        }
    };

    const visit = (manifest) => {
        const current = state.get(manifest.id);
        if (current === 'ok') {
            return true;
        }
        if (current === 'failed') {
            return false;
        }
        if (current === 'visiting') {
            addFailure(manifest.id, `dependency cycle detected involving "${manifest.id}" in ${source}`);
            state.set(manifest.id, 'failed');
            return false;
        }
        state.set(manifest.id, 'visiting');
        let resolved = true;
        manifest.depends.forEach((dependency) => {
            const parsed = parseDependency(dependency);
            if (!parsed.ok) {
                addFailure(manifest.id, parsed.error);
                resolved = false;
                return;
            }
            const target = manifests.get(parsed.id);
            if (!target) {
                addFailure(manifest.id, `missing dependency "${parsed.id}" required by "${manifest.id}" in ${source}`);
                resolved = false;
                return;
            }
            if (!satisfiesRange(target.version, parsed.range)) {
                addFailure(
                    manifest.id,
                    `dependency "${manifest.id}" requires "${parsed.id}@${parsed.range ?? '*'}" ` +
                    `but version ${target.version} is installed in ${source}`
                );
                resolved = false;
                return;
            }
            if (isEnabled && !isEnabled(parsed.id)) {
                addFailure(manifest.id, `dependency "${parsed.id}" required by "${manifest.id}" is not enabled in ${source}`);
                resolved = false;
                return;
            }
            if (!visit(target)) {
                addFailure(manifest.id, `dependency "${parsed.id}" required by "${manifest.id}" failed to resolve in ${source}`);
                resolved = false;
            }
        });
        if (!resolved) {
            state.set(manifest.id, 'failed');
            return false;
        }
        state.set(manifest.id, 'ok');
        order.push(manifest.id);
        return true;
    };

    const rootManifests = roots === null
        ? Array.from(manifests.values())
        : Array.from(roots).map((modId) => manifests.get(modId)).filter(Boolean);
    rootManifests.forEach((manifest) => { visit(manifest); });

    return { order, failures };
};

/*
 * Whole-graph variant kept for callers that need an all-or-nothing answer
 * (and for the unit tests): resolves every manifest and fails the batch when
 * any mod in it fails. The loader itself uses resolveLoadPlan so a broken mod
 * only takes down its own dependency subgraph.
 */
const resolveLoadOrder = (manifests, { source = 'unknown' } = {}) => {
    const plan = resolveLoadPlan(manifests, { source });
    if (plan.failures.size === 0) {
        return { ok: true, order: plan.order };
    }
    const errors = [];
    plan.failures.forEach((messages) => {
        messages.forEach((message) => {
            if (!errors.includes(message)) {
                errors.push(message);
            }
        });
    });
    return fail(errors);
};

module.exports = {
    FOLIUM_VERSION,
    KNOWN_PERMISSIONS,
    permissionGuarding,
    KNOWN_EXPERIMENTAL,
    MOD_ID_PATTERN,
    parseDependency,
    satisfiesRange,
    satisfiesHostRange,
    parseHostRange,
    validateManifest,
    resolveLoadOrder,
    resolveLoadPlan,
};

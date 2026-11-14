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

/*
 * The `folium` values a mod.json may declare (foliumShared.json `manifestVersions`). Folium 2.0: 1 and 2. A
 * `folium: 1` mod is read exactly as before; the fields below are for 2 only.
 */
const MANIFEST_VERSIONS = Object.freeze([...shared.manifestVersions]);
const FOLIUM_2_FIELDS = Object.freeze(['sources', 'locales', 'assets', 'secrets', 'contexts', 'native']);

/*
 * Folium 2.0 `sources[]` (plan §5.1). `id` is the source's name inside the mod: a third-party source is
 * known to the host as `folium.<mod id>.<id>`, a built-in one (and one that took over a short id) by the
 * short id itself, which is why mixed case is allowed (a short id may be camelCase). `claims` names what the source takes
 * over when the installation does not carry that source (the compliance plan, §5.1): the short id, and
 * the old main-process store keys, session partitions and userData folders that hold its sign-in.
 */
const SOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const STORE_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const PARTITION_PATTERN = /^(persist:)?[A-Za-z0-9_-]{1,64}$/;
const FOLDER_NAME_PATTERN = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,63}$/;
const HOST_NAME_PATTERN = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const CAPABILITY_ID_PATTERN = /^[a-z][a-z0-9.@-]{0,63}$/;

/*
 * Folium 2.0 (S3, plan §4.1): whether this host implements capability `key` (`search@1`), by the versions table of
 * foliumShared.json that `folium.sources.supports` answers from too. A source whose `requires` lists one it does
 * not is refused, not run pretending.
 */
const hostImplementsCapability = (key) => {
    const match = /^([a-z][a-z0-9.-]*)@([1-9]\d*)$/.exec(key);
    if (!match) return false;
    const versions = shared.sourceCapabilities[match[1]];
    return Array.isArray(versions) && versions.includes(Number(match[2]));
};
const NATIVE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SECRET_SLOT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const SECRET_SLOTS_MAX = 64;
const CLIENT_CONTEXTS = new Set(['main', 'export']);
const CLAIM_LIST_FIELDS = [
    ['storeKeys', STORE_KEY_PATTERN, 'a store key'],
    ['partitions', PARTITION_PATTERN, 'a session partition name'],
    ['userDataDirs', FOLDER_NAME_PATTERN, 'a folder name under userData'],
];
const SOURCE_FIELDS = new Set(['id', 'name', 'requires', 'keepForMatching', 'claims', 'certificateExceptions', 'lyricRelayHosts']);

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

/* Orders two version strings (negative, 0, positive); one that does not parse sorts below any that does. */
const compareVersionStrings = (left, right) => {
    const a = parseVersion(left);
    const b = parseVersion(right);
    if (!a || !b) return (a ? 1 : 0) - (b ? 1 : 0);
    return compareVersions(a, b);
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

const isStringList = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');

/* A source's display name: a string, or one string per language (`{ "en": "…", "zh-CN": "…" }`). */
const isSourceName = (value) => {
    if (isNonEmptyString(value)) {
        return value.length <= 64;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const entries = Object.entries(value);
    return entries.length > 0
        && entries.every(([language, text]) => /^[A-Za-z-]{2,16}$/.test(language) && isNonEmptyString(text) && text.length <= 64);
};

/* One `sources[].claims` (the compliance plan, §5.1): checked here, read by the loader's ownership rules. */
const validateClaims = (claims, where, errors) => {
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)) {
        errors.push(`${where}.claims must be an object`);
        return;
    }
    Object.keys(claims).forEach((field) => {
        if (field !== 'id' && !CLAIM_LIST_FIELDS.some(([name]) => name === field)) {
            errors.push(`${where}.claims has an unknown field "${field}"`);
        }
    });
    if (typeof claims.id !== 'string' || !SOURCE_ID_PATTERN.test(claims.id)) {
        errors.push(`${where}.claims.id must be the short source id it takes over`);
    }
    CLAIM_LIST_FIELDS.forEach(([field, pattern, what]) => {
        const list = claims[field];
        if (list === undefined) return;
        if (!isStringList(list) || !list.every((item) => pattern.test(item))) {
            errors.push(`${where}.claims.${field} must be a list where each entry is ${what}`);
        } else if (new Set(list).size !== list.length) {
            errors.push(`${where}.claims.${field} lists an entry twice`);
        }
    });
};

/* One entry of `sources`, at `where` (`sources[0]`); `ids` collects the ids seen so far. */
const validateSourceEntry = (source, where, ids, errors) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        errors.push(`${where} must be an object`);
        return;
    }
    Object.keys(source).forEach((field) => {
        if (!SOURCE_FIELDS.has(field)) errors.push(`${where} has an unknown field "${field}"`);
    });
    if (typeof source.id !== 'string' || !SOURCE_ID_PATTERN.test(source.id)) {
        errors.push(`${where}.id must match ${SOURCE_ID_PATTERN}`);
    } else if (ids.has(source.id)) {
        errors.push(`${where}.id "${source.id}" is listed twice`);
    } else {
        ids.add(source.id);
    }
    if (!isSourceName(source.name)) {
        errors.push(`${where}.name must be a string of at most 64 characters, or one per language`);
    }
    if (source.requires !== undefined && (!isStringList(source.requires) || !source.requires.every((id) => CAPABILITY_ID_PATTERN.test(id)))) {
        errors.push(`${where}.requires must be a list of capability ids like "search@1"`);
    } else if (source.requires !== undefined) {
        source.requires.forEach((key) => {
            if (key.startsWith('x.')) {
                errors.push(`${where}.requires "${key}": a custom capability is another mod's, not the host's to provide`);
            } else if (!hostImplementsCapability(key)) {
                errors.push(`${where}.requires "${key}": this host does not implement it`);
            }
        });
    }
    if (source.keepForMatching !== undefined && typeof source.keepForMatching !== 'boolean') {
        errors.push(`${where}.keepForMatching must be true or false`);
    }
    if (source.claims !== undefined) {
        validateClaims(source.claims, where, errors);
    }
    ['certificateExceptions', 'lyricRelayHosts'].forEach((field) => {
        if (source[field] !== undefined && (!isStringList(source[field]) || !source[field].every((host) => HOST_NAME_PATTERN.test(host)))) {
            errors.push(`${where}.${field} must be a list of host names`);
        }
    });
};

/*
 * The fields only `folium: 2` has (plan §5.1). A `folium: 1` mod.json that names one is refused: those
 * mods read exactly as they did in 1.9. A mod that declares `sources` is a source mod (§5.2), which is why
 * an empty declaration is refused: it would buy the source exemptions without providing a source.
 * `contexts` lists where the client runs ('main', 'export'; both when left out); a source mod's never
 * runs in the export window.
 */
const validateFolium2Fields = (manifest, errors) => {
    const present = FOLIUM_2_FIELDS.filter((field) => manifest[field] !== null);
    if (manifest.folium !== 2) {
        present.forEach((field) => errors.push(`"${field}" needs "folium": 2`));
        return;
    }
    if (manifest.sources !== null) {
        if (!Array.isArray(manifest.sources) || manifest.sources.length === 0) {
            errors.push('mod.sources must list at least one source; a mod without sources leaves the field out');
        } else {
            const ids = new Set();
            manifest.sources.forEach((source, index) => validateSourceEntry(source, `sources[${index}]`, ids, errors));
        }
        if (manifest.client === null) {
            errors.push('a source mod needs a "client" entry: its sources are registered there');
        }
    }
    ['locales', 'assets'].forEach((field) => {
        if (manifest[field] !== null && !isSafeRelativePath(manifest[field])) {
            errors.push(`mod.${field} must be a relative folder path inside the mod directory`);
        }
    });
    if (manifest.secrets !== null) {
        if (!isStringList(manifest.secrets) || !manifest.secrets.every((key) => SECRET_SLOT_PATTERN.test(key))) {
            errors.push(`mod.secrets must be a list of key names matching ${SECRET_SLOT_PATTERN}`);
        } else if (manifest.secrets.length > SECRET_SLOTS_MAX) {
            errors.push(`mod.secrets has at most ${SECRET_SLOTS_MAX} keys`);
        } else if (new Set(manifest.secrets).size !== manifest.secrets.length) {
            errors.push('mod.secrets lists a key twice');
        }
    }
    if (manifest.contexts !== null) {
        if (!isStringList(manifest.contexts) || manifest.contexts.length === 0 || !manifest.contexts.every((context) => CLIENT_CONTEXTS.has(context))) {
            errors.push('mod.contexts must list where the client runs: "main", "export"');
        } else if (manifest.sources !== null && manifest.contexts.includes('export')) {
            errors.push('a source mod\'s client never runs in the export window; leave "export" out of mod.contexts');
        }
    }
    if (manifest.native !== null && (!isStringList(manifest.native) || !manifest.native.every((name) => NATIVE_NAME_PATTERN.test(name)))) {
        errors.push(`mod.native must be a list of names matching ${NATIVE_NAME_PATTERN}`);
    }
};

/** Whether a validated manifest is a source mod (Folium 2.0 plan §5.2): `folium: 2` with `sources`. */
const isSourceManifest = (manifest) => Boolean(
    manifest && manifest.folium === 2 && Array.isArray(manifest.sources) && manifest.sources.length > 0,
);

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
        // Folium 2 only (validateFolium2Fields); null when the mod.json does not have them.
        sources: raw.sources ?? null,
        locales: raw.locales ?? null,
        assets: raw.assets ?? null,
        secrets: raw.secrets ?? null,
        contexts: raw.contexts ?? null,
        native: raw.native ?? null,
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

    if (!MANIFEST_VERSIONS.includes(manifest.folium)) {
        errors.push(`unsupported folium version ${JSON.stringify(manifest.folium)}; this host reads folium ${MANIFEST_VERSIONS.join(' and ')}`);
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

    validateFolium2Fields(manifest, errors);

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
    MANIFEST_VERSIONS,
    SOURCE_ID_PATTERN,
    isSourceManifest,
    compareVersionStrings,
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

// electron/modSystem/modApi.cjs
// The restricted API surface injected into mod entry modules.
// A mod only ever sees this object plus what the loader explicitly grants;
// it never receives Electron primitives, Node internals, or loader internals.

'use strict';

const fs = require('fs');
const path = require('path');

const DATA_FILE_NAME = 'mod-data.json';

// Permission each guarded API family requires. `render.export` is enforced by
// the loader itself (it owns the export service), everything else is enforced
// here, at the call site, so a permission a mod did not declare is unreachable
// rather than merely undocumented.
const STORAGE_PERMISSION = 'filesystem.data';
const PLAYBACK_PERMISSION = 'runtime.playback';

const cloneJson = (value) => JSON.parse(JSON.stringify(value));

/*
 * context: {
 *   modId, manifest, dataDir,
 *   emitLog(level, message),
 *   getRuntimeSnapshot(),
 *   registerDisposer(fn),       // run when the mod is disabled, reloaded, or the app quits
 *   requestExport(spec),        // permission render.export enforced by the loader
 * }
 */
const createModApi = (context) => {
    const declaredPermissions = Array.isArray(context.manifest?.permissions) ? context.manifest.permissions : [];

    /*
     * Fail-closed permission gate. Throws the same `permission-denied:<id>`
     * shape the command invoker returns, so a mod sees one consistent error
     * whether it was blocked at declaration time or at call time.
     */
    const requirePermission = (permission) => {
        if (!declaredPermissions.includes(permission)) {
            throw new Error(`permission-denied:${permission}`);
        }
    };

    const log = {
        info: (message, details) => context.emitLog('info', message, details),
        warn: (message, details) => context.emitLog('warn', message, details),
        error: (message, details) => context.emitLog('error', message, details),
    };

    /*
     * Per-mod private key/value store persisted under the mod data directory.
     * All access is serialized JSON; read/write failures degrade to null/throw
     * instead of corrupting loader state.
     */
    const createDataStorage = () => {
        const dataFilePath = () => path.join(context.dataDir, DATA_FILE_NAME);
        const loadData = () => {
            try {
                const raw = fs.readFileSync(dataFilePath(), 'utf8');
                const parsed = JSON.parse(raw);
                return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
            } catch {
                return {};
            }
        };
        const saveData = (data) => {
            fs.mkdirSync(context.dataDir, { recursive: true });
            const tempPath = dataFilePath() + '.tmp';
            fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
            fs.renameSync(tempPath, dataFilePath());
        };
        return {
            get: (key) => {
                requirePermission(STORAGE_PERMISSION);
                if (typeof key !== 'string' || key.length === 0) {
                    return undefined;
                }
                const data = loadData();
                return key in data ? cloneJson(data[key]) : undefined;
            },
            set: (key, value) => {
                requirePermission(STORAGE_PERMISSION);
                if (typeof key !== 'string' || key.length === 0) {
                    throw new Error('[ModApi] storage key must be a non-empty string');
                }
                const data = loadData();
                data[key] = cloneJson(value);
                saveData(data);
            },
            has: (key) => {
                requirePermission(STORAGE_PERMISSION);
                return typeof key === 'string' && key in loadData();
            },
            delete: (key) => {
                requirePermission(STORAGE_PERMISSION);
                if (typeof key !== 'string') {
                    return;
                }
                const data = loadData();
                delete data[key];
                saveData(data);
            },
        };
    };

    return {
        // Frozen manifest so mods cannot rewrite their own contract at runtime.
        manifest: Object.freeze(cloneJson(context.manifest)),
        log,
        storage: {
            data: createDataStorage(),
        },
        /*
         * Cleanup hook. Anything a mod starts in activate() — timers, watchers,
         * listeners, child processes — should be released here; the loader runs
         * these before the mod stops being active, so a disabled mod really
         * stops instead of lingering until the next app start. Returning a
         * function from activate() registers it the same way.
         */
        lifecycle: {
            onDeactivate: (disposer) => context.registerDisposer(disposer),
        },
        runtime: {
            getPlaybackSnapshot: () => {
                requirePermission(PLAYBACK_PERMISSION);
                return context.getRuntimeSnapshot();
            },
        },
        /*
         * Command registration is the primary contribution point of apiVersion 1.
         * Commands are projected into the renderer panel as forms built from
         * the declared params schema; execution routes back through the loader
         * which enforces the declared permissions.
         */
        commands: {
            register: (command) => {
                if (!command || typeof command.id !== 'string' || typeof command.run !== 'function') {
                    throw new Error('[ModApi] commands.register requires an object with an id and a run function');
                }
                const normalized = {
                    id: command.id,
                    label: typeof command.label === 'object' && command.label !== null ? command.label : {},
                    description: typeof command.description === 'object' && command.description !== null ? command.description : {},
                    params: Array.isArray(command.params) ? command.params : [],
                    permissions: Array.isArray(command.permissions) ? command.permissions : [],
                    run: command.run,
                };
                context.registerCommand(normalized);
                return normalized;
            },
        },
        /*
         * Starts a video export session through the loader-provided renderer.
         * The loader enforces `render.export`; calling without the permission
         * rejects with a permission error instead of silently running.
         */
        render: {
            exportVideo: (spec) => context.requestExport(spec),
        },
    };
};

module.exports = { createModApi, DATA_FILE_NAME, PLAYBACK_PERMISSION, STORAGE_PERMISSION };
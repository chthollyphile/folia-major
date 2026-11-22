// electron/modSystem/discovery.cjs
// Finding mods on disk: which folders are scanned, which folder inside an
// entry of them is the mod's root, and what each mod.json says. It reads files
// and runs no mod code. Cut out of modSystem.cjs, which decides what happens
// to what is found here.

'use strict';

// original-fs: a .asar file in a mod directory is a file here, not a directory (rawFs.cjs).
const { rawFs: fs } = require('./rawFs.cjs');
const path = require('path');

const { validateManifest } = require('./manifest.cjs');

/*
 * `app` is Electron's: its paths and `isPackaged` decide which folders are
 * scanned. `serializeError` turns a failure into the text a mod's row shows.
 */
const createModDiscovery = ({ app, serializeError }) => {
    const getModsDirectories = () => {
        const directories = [];
        const repoMods = path.join(app.getAppPath(), 'mods');
        // In production the packaged app is read-only; user-installed mods live
        // under userData and packaged mods under resources.
        const isPackaged = app.isPackaged;
        if (!isPackaged) {
            directories.push(repoMods);
        }
        directories.push(path.join(app.getPath('userData'), 'mods'));
        if (process.resourcesPath) {
            directories.push(path.join(process.resourcesPath, 'mods'));
        }
        return directories;
    };

    /*
     * Folium 2.0 (plan §5.1): the folder of the built-in mods, the sources the installation carries. In a
     * packaged app it is resources/builtin-mods (extraResources); in a development build the build output
     * dist-mods/ in the source tree. Its mods are the `builtin` tier: trusted by where they are, like the
     * host code in app.asar, so no content digest and no signature is computed for them.
     */
    const getBuiltinModsDirectory = () => {
        if (app.isPackaged) {
            return process.resourcesPath ? path.join(process.resourcesPath, 'builtin-mods') : null;
        }
        return path.join(app.getAppPath(), 'dist-mods');
    };

    /*
     * Finds the mod root inside one entry of a mods directory, with the same
     * rule as a zip install (resolveArchiveRoot): mod.json in the entry itself,
     * or in exactly one subfolder. A downloaded zip extracted by hand usually
     * leaves that extra folder (mods/foo-1.0.0/foo/mod.json). Anything else
     * falls back to the entry, which then reports the missing mod.json.
     */
    const resolveModRoot = (entryDirectory) => {
        if (fs.existsSync(path.join(entryDirectory, 'mod.json'))) {
            return entryDirectory;
        }
        let children = [];
        try {
            children = fs.readdirSync(entryDirectory, { withFileTypes: true });
        } catch {
            return entryDirectory;
        }
        const candidates = children
            .filter((child) => child.isDirectory() && !child.name.startsWith('.'))
            .map((child) => path.join(entryDirectory, child.name))
            .filter((childDirectory) => fs.existsSync(path.join(childDirectory, 'mod.json')));
        return candidates.length === 1 ? candidates[0] : entryDirectory;
    };

    /*
     * Reads every mod.json under the folders `directories`, one map of discoveries: a valid mod under its
     * id, a broken one under its folder name, and a second copy of an id under a key of its own carrying
     * a duplicate error, so neither silently replaces the other.
     */
    /*
     * Which tier a folder of mods is (Folium 2.0): 'repo' (the source tree's mods/, development builds only),
     * 'user' (userData/mods), 'resources' (resources/mods), 'builtin' (getBuiltinModsDirectory).
     */
    const tierOfDirectory = (dirPath) => {
        if (dirPath === getBuiltinModsDirectory()) return 'builtin';
        if (dirPath === path.join(app.getPath('userData'), 'mods')) return 'user';
        if (!app.isPackaged && dirPath === path.join(app.getAppPath(), 'mods')) return 'repo';
        return 'resources';
    };

    const readManifestsIn = (directories) => {
        const discovered = new Map();
        const seenIds = new Set();
        directories.forEach((dirPath) => {
            let dirEntries = [];
            try {
                dirEntries = fs.readdirSync(dirPath, { withFileTypes: true });
            } catch {
                return; // Directory missing — nothing to discover here.
            }
            // Dot-directories are the loader's own bookkeeping (staged installs
            // and rollback copies), never mods.
            const tier = tierOfDirectory(dirPath);
            dirEntries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).forEach((entry) => {
                const modDirectory = resolveModRoot(path.join(dirPath, entry.name));
                const manifestPath = path.join(modDirectory, 'mod.json');
                let raw = null;
                try {
                    raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                } catch (error) {
                    const existing = discovered.get(entry.name) ?? { dirPath: modDirectory, manifest: null, validationErrors: null, tier };
                    if (!existing.validationErrors) {
                        existing.validationErrors = [`cannot read mod.json: ${serializeError(error)}`];
                        discovered.set(entry.name, existing);
                    }
                    return;
                }
                const validation = validateManifest(raw);
                if (!validation.ok) {
                    discovered.set(entry.name, { dirPath: modDirectory, manifest: null, validationErrors: validation.errors, tier });
                    return;
                }
                const manifest = validation.value;
                if (seenIds.has(manifest.id)) {
                    discovered.set(`${entry.name}-duplicate-${manifest.id}`, {
                        dirPath: modDirectory,
                        manifest,
                        validationErrors: [`duplicate mod id "${manifest.id}"`],
                        tier,
                    });
                    return;
                }
                seenIds.add(manifest.id);
                discovered.set(manifest.id, { dirPath: modDirectory, manifest, validationErrors: null, tier });
            });
        });
        return discovered;
    };

    /* The mods of the folders users and the app put mods in (getModsDirectories); built-in ones apart. */
    const readManifestFiles = () => readManifestsIn(getModsDirectories());

    /*
     * The built-in mods (getBuiltinModsDirectory), apart from the rest: a user copy of the same id is not a
     * duplicate of a built-in one but an override candidate (plan §5.1). An empty or missing folder is an
     * empty map, and the loader then behaves as it did before Folium 2.0.
     */
    const readBuiltinManifests = () => {
        const directory = getBuiltinModsDirectory();
        return directory ? readManifestsIn([directory]) : new Map();
    };

    // Placeholder manifest for a discovery that never produced a usable one, so
    // broken mods still show up in the panel with their validation errors.
    const brokenManifest = (id, discovery) => ({
        id,
        name: discovery.manifest?.name ?? id,
        version: discovery.manifest?.version ?? null,
        author: discovery.manifest?.author ?? null,
        description: discovery.manifest?.description ?? null,
        permissions: [],
        experimental: [],
        embedOrigins: [],
        folia: null,
        main: null,
        client: null,
        sources: null,
    });

    return { getModsDirectories, getBuiltinModsDirectory, readManifestFiles, readBuiltinManifests, brokenManifest };
};

module.exports = { createModDiscovery };

// sources/qq/main/qqApiExports.ts
// Which object `import('@yakult-green-tea/qq-music-api')` gave is the package's exports (main/index.ts loads it from the deps archive).

import fs from 'node:fs';
import path from 'node:path';
import { QQ_API_MODULE } from './qqApiStartup.cjs';

/** The `server` an object carries, if any. */
export const serverOf = (value: unknown): unknown => (value && typeof value === 'object' ? (value as { server?: unknown }).server : undefined);

/**
 * The package's exports from what `import()` gave. The package is compiled TypeScript: its exports object carries
 * `server` and `configureAuthSessionRepository`, and its `default` is the Koa app, which has neither. So the namespace
 * itself when it carries the server, its `default` only when that is where the exports are (an ESM wrapper).
 */
export const qqApiExportsOf = (namespace: unknown): unknown => {
    if (serverOf(namespace)) return namespace;
    const fallback = namespace && typeof namespace === 'object' ? (namespace as { default?: unknown }).default : undefined;
    return serverOf(fallback) ? fallback : namespace;
};

/**
 * The package's folder, from the module the archive loaded (require.cache keeps it under its file): the diagnostic hooks
 * load two of its inner files by path (qqBackend.cjs installQqLoginHooks). Found by its server, which is one object
 * whatever wrapper the import put around the exports.
 */
export const packageRootOf = (loaded: unknown, cache: NodeJS.Dict<NodeJS.Module> = require.cache): string => {
    const server = serverOf(loaded);
    const entry = Object.values(cache).find(module => module?.exports === loaded || (server !== undefined && serverOf(module?.exports) === server));
    let dir = entry ? path.dirname(entry.filename) : '';
    while (dir && path.dirname(dir) !== dir) {
        const manifest = path.join(dir, 'package.json');
        try {
            const read = JSON.parse(fs.readFileSync(manifest, 'utf8')) as { name?: unknown; main?: unknown; exports?: unknown } | null;
            // The package's own manifest says where its entry is; the one it ships in dist/ has only its name and version.
            if (read?.name === QQ_API_MODULE && (read.main !== undefined || read.exports !== undefined)) return dir;
        } catch {
            // No package.json here, or another package's, or the stub in dist/: one folder up.
        }
        dir = path.dirname(dir);
    }
    throw new Error(`${QQ_API_MODULE}: its folder was not found`);
};

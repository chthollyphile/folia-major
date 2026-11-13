// electron/modSystem/rawFs.cjs
// The file system the mod loader reads and writes mod directories with: Electron's `original-fs`, the
// Node `fs` without Electron's asar patch. Under the patched `fs` a `.asar` file inside a mod directory
// (a source mod's dependency archive, `deps.<hash>.asar`) looks like a directory: `statSync` says
// directory, `readFileSync` and `copyFileSync` on it throw ENOENT, while `readdirSync` of its parent still
// lists it as a file (Folium 2.0 plan §13, the S0 probe). Hashing, signing, installing and measuring a mod
// must see the archive as the file it is. Outside Electron (unit tests, Node scripts) there is no
// `original-fs` and the plain `fs` already behaves that way.

'use strict';

/*
 * `load(name)` is `require` by default; tests hand in their own to see which module is picked. The first
 * of `original-fs` and `fs` that loads is the answer.
 */
const pickRawFs = (load = require) => {
    try {
        return load('original-fs');
    } catch {
        return load('fs');
    }
};

const rawFs = pickRawFs();

module.exports = { rawFs, pickRawFs };

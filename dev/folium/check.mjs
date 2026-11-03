#!/usr/bin/env node
// dev/folium/check.mjs
// `npm run folium:check <folder>`: looks a mod folder over without running it.
//
// What it checks, each with the app's own code and tables, not a copy of them:
//   - mod.json, through the loader's validator (electron/modSystem/manifest.cjs),
//     so a manifest that passes here is one the app accepts, and the words of a
//     failure are the words the mod's row would show;
//   - the Folia version mod.json asks for (`folia`), against this checkout's;
//   - that the files mod.json names (client, main, preview) are there, and that
//     the client entry has a default export that is not an object; a missing
//     `preview` is a note, since a submission to the mod market needs one;
//   - every `folium.registries.<name>.register` in the client entry and the
//     files it imports (also written `?.register` or `['<name>']`): the registry
//     exists, and the permission it needs is declared (the kinds table,
//     src/mods/folium/kinds.ts);
//   - every `folium.experimental['<name>']` there: the name exists and mod.json
//     opts into it;
//   - every `folium.events.on('<name>', ...)` there: the event exists, and an
//     experimental one is opted into (the event types table,
//     src/mods/folium/eventTypes.ts);
//   - every member a permission guards (the `guards` lists of
//     electron/modSystem/foliumShared.json): `folium.*` in the client entry and
//     its files, `api.*` in the main entry and the files it requires; a member
//     used without its permission declared is a problem;
//   - that the folder can be hashed (a folder that cannot is never enabled), and
//     whether it carries an official signature that still matches its files;
//   - Folium 1.6 only: the names Folium 2 removes, in mod.json and in the code
//     (the tables of src/mods/folium/deprecated/oldNames.ts and
//     electron/modSystem/deprecated.cjs). They still work: each is a warning,
//     not a problem.
//
// What it does not do: it never runs the mod. It reads code as text, with
// comments and the insides of strings left out. So a member reached through
// another name (`const r = folium.registries`, `const { storage } = api`, a
// main entry whose parameter is not called `api`) is not seen; a default export
// is only known to be written, not to be a function; a regular expression that
// holds a quote or `//` can hide the rest of its line; and nothing is known
// about what `activate` or a `mount` does, whether they throw, or what they
// leave behind. Whether the mods it depends on are installed and enabled is
// not looked at either. For all that, enable the mod in the app and look at
// its row in Settings.
//
//   node dev/folium/check.mjs <folder>     a path, or the name of a folder under mods/
//   exit code 0: no problem found; 1: problems; 2: wrong usage.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { FOLIUM_KINDS } from '../../src/mods/folium/kinds.ts';
import { FOLIUM_EVENT_TYPES } from '../../src/mods/folium/eventTypes.ts';
import { FOLIUM_OLD_CLIENT_NAMES, FOLIUM_OLD_REGISTRY_NAMES, foliumOldNameAdvice } from '../../src/mods/folium/deprecated/oldNames.ts';
import { readFoliumShared } from './api-docs.mjs';

const require = createRequire(import.meta.url);
const { validateManifest, satisfiesHostRange } = require('../../electron/modSystem/manifest.cjs');
const { OLD_MAIN_NAMES, oldNameText, oldNameWarnings } = require('../../electron/modSystem/deprecated.cjs');
const { computeModDigest } = require('../../electron/modSystem/modDigest.cjs');
const { verifyModSignature } = require('../../electron/modSystem/modSignature.cjs');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * A folder given as the name of a folder under the repository's mods/, or as a path: anything with
 * a separator in it (`./my-mod`, `D:/mods/my-mod`), and `.` or `..`. A separator at the end does
 * not make a name a path.
 */
export const resolveModFolder = (given) => {
    const name = given.replace(/[\\/]+$/, '');
    if (/[\\/]/.test(name) || name === '.' || name === '..' || name === '') {
        return path.resolve(given);
    }
    return path.join(ROOT, 'mods', name);
};

/*
 * The text with comments blanked out and every string emptied (the quotes stay, what is between
 * them becomes spaces), and what each string held, by the place of its opening quote. Every place
 * in the result is the same place in the file. A template literal counts as one string, `${...}`
 * and all. This is a reading of text, not a parser.
 */
const blankCommentsAndStrings = (text) => {
    const out = text.split('');
    const strings = new Map();
    const blank = (from, to) => {
        for (let at = from; at < Math.min(to, out.length); at += 1) {
            if (out[at] !== '\n' && out[at] !== '\r') out[at] = ' ';
        }
    };
    let index = 0;
    while (index < text.length) {
        const char = text[index];
        const next = text[index + 1];
        if (char === '/' && next === '/') {
            const close = text.indexOf('\n', index);
            const end = close === -1 ? text.length : close;
            blank(index, end);
            index = end;
        } else if (char === '/' && next === '*') {
            const close = text.indexOf('*/', index + 2);
            const end = close === -1 ? text.length : close + 2;
            blank(index, end);
            index = end;
        } else if (char === '\'' || char === '"' || char === '`') {
            let end = index + 1;
            // Only a template literal goes on over the end of a line.
            while (end < text.length && text[end] !== char && (char === '`' || text[end] !== '\n')) {
                end += text[end] === '\\' ? 2 : 1;
            }
            strings.set(index, { text: text.slice(index + 1, end), end });
            blank(index + 1, end);
            index = end + 1;
        } else {
            index += 1;
        }
    }
    return { code: out.join(''), strings };
};

/** True when `pattern` (a sticky expression) matches `code` starting exactly at `at`. */
const matchesAt = (pattern, code, at) => {
    pattern.lastIndex = at;
    return pattern.exec(code);
};

/**
 * What one file uses of `folium.registries`, `folium.experimental` and `folium.events`, by name,
 * and its code with comments and strings blanked, where the guarded members are looked for.
 */
const readUses = (text) => {
    const { code, strings } = blankCommentsAndStrings(text);
    const registries = [];
    const experimental = [];
    const events = [];
    // The platform ids passed to a `.request('<id>', …)`: platform.raw's, when the mod opts into it.
    const platformRequests = [];
    for (const match of code.matchAll(/\bregistries\s*(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)\s*(?:\?\.|\.)\s*register\b/g)) {
        registries.push(match[1]);
    }
    for (const match of code.matchAll(/\bregistries\s*(?:\?\.)?\s*\[\s*(?=['"`])/g)) {
        const literal = strings.get(match.index + match[0].length);
        if (literal && matchesAt(/.\s*\]\s*(?:\?\.|\.)\s*register\b/y, code, literal.end)) registries.push(literal.text);
    }
    for (const match of code.matchAll(/\bexperimental\s*(?:\?\.)?\s*\[\s*(?=['"`])/g)) {
        const literal = strings.get(match.index + match[0].length);
        if (literal && matchesAt(/.\s*\]/y, code, literal.end)) experimental.push(literal.text);
    }
    for (const match of code.matchAll(/\bevents\s*(?:\?\.|\.)\s*on\s*\(\s*(?=['"`])/g)) {
        const literal = strings.get(match.index + match[0].length);
        // A name built at run time (`${...}`) cannot be known here.
        if (literal && !literal.text.includes('${')) events.push(literal.text);
    }
    for (const match of code.matchAll(/(?:\?\.|\.)\s*request\s*\(\s*(?=['"`])/g)) {
        const literal = strings.get(match.index + match[0].length);
        if (literal && /^[a-z][a-z0-9-]*$/.test(literal.text)) platformRequests.push(literal.text);
    }
    return { code, registries, experimental, events, platformRequests };
};

/** Matches a use of `member` (e.g. `api.runtime.getPlaybackSnapshot`), each dot also written `?.`. */
const memberPattern = (member) => new RegExp(`\\b${member.split('.').join('\\s*\\??\\.\\s*')}(?![\\w$])`);

/*
 * An entry and the files of the mod it imports or requires by a relative path, as text. A file
 * outside the folder, or one that is not there, is left out: the app would not load it either. A
 * `require` also finds the file with `.js` or `.cjs` added, as Node does.
 */
const readModCode = (directory, entry) => {
    const seen = new Map();
    const visit = (file) => {
        if (seen.has(file) || !file.startsWith(directory + path.sep)) return;
        let text;
        try {
            text = fs.readFileSync(file, 'utf8');
        } catch {
            return;
        }
        seen.set(file, text);
        for (const match of text.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
            visit(path.resolve(path.dirname(file), match[1]));
        }
        for (const match of text.matchAll(/\brequire\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
            const target = path.resolve(path.dirname(file), match[1]);
            const found = [target, `${target}.js`, `${target}.cjs`].find((candidate) => fs.statSync(candidate, { throwIfNoEntry: false })?.isFile());
            if (found) visit(found);
        }
    };
    visit(path.resolve(directory, entry));
    return seen;
};

/*
 * Folium 1.6 only: the old names (rows of the two deprecation tables) that `files` (file to text) use, each
 * said once, in the words `text` gives a row ("<old name>: removed in Folium 2, use <new name>").
 */
const oldNameWarningsIn = (files, rows, text) => {
    const readings = Array.from(files.values(), (source) => blankCommentsAndStrings(source));
    return rows
        .filter(({ pattern, inStrings }) => pattern !== null && readings.some(({ code, strings }) => (inStrings
            ? Array.from(strings.values()).some((literal) => pattern.test(literal.text))
            : pattern.test(code))))
        .map(text);
};

/**
 * Looks one mod folder over. `problems` are what keeps the mod from loading or working as written;
 * `notes` are things to know; `warnings` (Folium 1.6 only) the names it uses that Folium 2 removes.
 * Runs none of the mod's code.
 */
export const checkFoliumMod = (directory) => {
    const problems = [];
    const notes = [];
    const warnings = [];
    const result = (manifest = null) => ({ ok: problems.length === 0, problems, notes, warnings, manifest });

    let raw;
    try {
        raw = JSON.parse(fs.readFileSync(path.join(directory, 'mod.json'), 'utf8'));
    } catch (error) {
        problems.push(`cannot read mod.json: ${error.message}`);
        return result();
    }
    const validation = validateManifest(raw);
    if (!validation.ok) {
        problems.push(...validation.errors.map((error) => `mod.json: ${error}`));
        return result();
    }
    const manifest = validation.value;
    warnings.push(...oldNameWarnings(manifest));
    if (manifest.id !== path.basename(directory)) {
        notes.push(`the folder is named "${path.basename(directory)}" and the mod's id is "${manifest.id}": both work, the same name is easier to find`);
    }

    for (const field of ['client', 'main', 'preview']) {
        if (manifest[field] !== null && !fs.existsSync(path.join(directory, manifest[field]))) {
            problems.push(`mod.json names "${manifest[field]}" as its ${field}, and that file is not in the folder`);
        }
    }
    if (manifest.preview === null) {
        notes.push('mod.json has no "preview": the app needs none, a submission to the mod market does (a .png, .jpg or .webp image in the folder)');
    }

    // The app does not run a mod that asks for another Folia than the one it is (host-version-mismatch).
    const hostVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
    if (manifest.folia && !satisfiesHostRange(hostVersion, manifest.folia)) {
        problems.push(`mod.json asks for Folia "${manifest.folia}" and this checkout is ${hostVersion}: the app would not run the mod`);
    }
    if (manifest.depends.length > 0) {
        notes.push(`depends on ${manifest.depends.join(', ')}: whether those mods are installed and enabled is not looked at here; the app does not run this mod without them`);
    }

    const shared = readFoliumShared();
    // Each member a permission guards, with that permission. A registry's permission is the kinds
    // table's, which the app's registries read; those are checked with the registries below.
    const guarded = Object.entries(shared.permissions).flatMap(([id, permission]) => permission.guards
        .filter((member) => !member.startsWith('folium.registries.'))
        .map((member) => ({ member, id, pattern: memberPattern(member) })));
    // `root` is 'folium' for the client entry's code, 'api' for the main entry's.
    const checkGuarded = (codes, root) => {
        for (const { member, id, pattern } of guarded) {
            if (member.startsWith(`${root}.`) && !manifest.permissions.includes(id) && codes.some((code) => pattern.test(code))) {
                problems.push(`${member} needs the permission "${id}" in mod.json`);
            }
        }
    };

    if (manifest.client !== null) {
        const files = readModCode(directory, manifest.client);
        const uses = new Map(Array.from(files, ([file, text]) => [file, readUses(text)]));
        const entry = uses.get(path.resolve(directory, manifest.client));
        if (entry !== undefined) {
            if (/\bexport\s+default\s*\{/.test(entry.code)) {
                problems.push(`${manifest.client} exports an object as its default: the app calls the default export itself as activate(folium), so it has to be a function`);
            } else if (!/\bexport\s+default\b|\bas\s+default\b|\bexport\s*\{[^}]*\bdefault\b[^}]*\}/.test(entry.code)) {
                problems.push(`${manifest.client} has no default export: the app calls its default export as activate(folium)`);
            }
        }
        const used = { registries: new Set(), experimental: new Set(), events: new Set(), platformRequests: new Set() };
        for (const use of uses.values()) {
            use.registries.forEach((name) => used.registries.add(name));
            use.experimental.forEach((name) => used.experimental.add(name));
            use.events.forEach((name) => used.events.add(name));
            use.platformRequests.forEach((id) => used.platformRequests.add(id));
        }
        for (const usedName of used.registries) {
            // Folium 1.6 only: an old registry name means the registry it is now (the warning is below).
            const name = Object.hasOwn(FOLIUM_OLD_REGISTRY_NAMES, usedName) ? FOLIUM_OLD_REGISTRY_NAMES[usedName] : usedName;
            const kind = Object.hasOwn(FOLIUM_KINDS, name) ? FOLIUM_KINDS[name] : null;
            if (!kind) {
                problems.push(`folium.registries has no "${name}" (it has: ${Object.keys(FOLIUM_KINDS).join(', ')})`);
            } else if (kind.permission !== null && !manifest.permissions.includes(kind.permission)) {
                problems.push(`folium.registries.${name} needs the permission "${kind.permission}" in mod.json`);
            }
        }
        const experimentalNames = Object.values(shared.experimental);
        for (const name of used.experimental) {
            if (!experimentalNames.includes(name)) {
                problems.push(`folium.experimental has no "${name}" (it has: ${experimentalNames.join(', ')})`);
            } else if (!manifest.experimental.includes(name)) {
                problems.push(`folium.experimental['${name}'] needs "${name}" under "experimental" in mod.json`);
            }
        }
        /*
         * Folium 1.7 platform.raw: its permissions guard a member a mod can only reach with brackets
         * (`experimental['platform.raw'].request`), which the guards table's dotted names never match.
         * Here the platform ids the code passes to `request` are held to `platform.<id>.read`. Whether an
         * endpoint writes is not told by the code, so `.write` is left to the app.
         */
        if (used.experimental.has(shared.experimental.platformRaw)) {
            const declaredRead = manifest.permissions.filter((id) => /^platform\.[^.]+\.read$/.test(id));
            for (const platformId of used.platformRequests) {
                const permission = `platform.${platformId}.read`;
                if (!Object.hasOwn(shared.permissions, permission)) {
                    problems.push(`folium.experimental['platform.raw'] cannot call "${platformId}": no platform of that id has raw endpoints`);
                } else if (!manifest.permissions.includes(permission)) {
                    problems.push(`folium.experimental['platform.raw'].request('${platformId}', …) needs the permission "${permission}" in mod.json`);
                }
            }
            if (used.platformRequests.size === 0 && declaredRead.length === 0) {
                notes.push("uses folium.experimental['platform.raw'] and declares no platform.<platform>.read permission: describe needs none, every request is refused with permission-denied");
            }
        }
        for (const name of used.events) {
            const type = Object.hasOwn(FOLIUM_EVENT_TYPES, name) ? FOLIUM_EVENT_TYPES[name] : null;
            if (!type) {
                problems.push(`folium.events has no "${name}" event (it has: ${Object.keys(FOLIUM_EVENT_TYPES).join(', ')})`);
            } else if (type.experimental !== null && !manifest.experimental.includes(type.experimental)) {
                problems.push(`folium.events.on('${name}') needs "${type.experimental}" under "experimental" in mod.json`);
            }
        }
        checkGuarded(Array.from(uses.values(), (use) => use.code), 'folium');
        warnings.push(...oldNameWarningsIn(files, Object.values(FOLIUM_OLD_CLIENT_NAMES), (row) => `${row.old}: ${foliumOldNameAdvice(row)}`));
    }
    if (manifest.main !== null) {
        const files = readModCode(directory, manifest.main);
        checkGuarded(Array.from(files.values(), (text) => blankCommentsAndStrings(text).code), 'api');
        warnings.push(...oldNameWarningsIn(files, Object.values(OLD_MAIN_NAMES), oldNameText));
    }

    if (!computeModDigest(directory)) {
        problems.push('the folder cannot be hashed (too many files, a file too large, or a link in it): the app never enables such a mod');
    }
    const signature = verifyModSignature(directory, manifest);
    if (signature.status === 'verified') {
        notes.push(`signed: the official signature matches these files (${signature.keyId})`);
    } else if (signature.status === 'invalid') {
        notes.push(`signed, and the signature does not match (${signature.reason}): the files changed after signing, the app shows it as "签名不匹配"`);
    } else {
        notes.push('not signed: the app shows it as "未验证", which is what a mod is until Folium has reviewed and signed it');
    }
    return result(manifest);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const given = process.argv[2];
    if (!given) {
        console.error('usage: npm run folium:check <folder>   (a path, or the name of a folder under mods/)');
        process.exit(2);
    }
    const directory = resolveModFolder(given);
    const { ok, problems, notes, warnings, manifest } = checkFoliumMod(directory);
    console.log(`${manifest ? `${manifest.name} (${manifest.id} ${manifest.version})` : path.basename(directory)}  ${directory}`);
    problems.forEach((problem) => console.log(`  problem: ${problem}`));
    warnings.forEach((warning) => console.log(`  warning: ${warning}`));
    notes.forEach((note) => console.log(`  note: ${note}`));
    console.log(ok
        ? '  no problem found. This looked at the files only: it did not run the mod.'
        : `  ${problems.length} problem${problems.length === 1 ? '' : 's'} found.`);
    process.exit(ok ? 0 : 1);
}

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { CONTRACT_PATH, MAIN_CONTRACT_PATH } from '../../../dev/folium/api-docs.mjs';
import { renderFoliumTypes, TYPES_PATH } from '../../../dev/folium/types.mjs';
import { checkFoliumMod, resolveModFolder } from '../../../dev/folium/check.mjs';
import { checkCommandFor, createFoliumMod, typesImportFor } from '../../../dev/folium/new.mjs';

// test/unit/mod-system/foliumAuthorTools.test.ts
// The tools for mod authors (dev/folium/). The type file for editors is made
// from the contract and must not go stale; the starting mod `folium:new`
// writes must pass `folium:check`; and the check must find the faults it says
// it finds, in a folder it only reads.

let root = '';
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'folium-author-tools-'));
});
afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

/* A mod folder with the given manifest fields over a valid one, and the given client code. */
const writeMod = (id: string, manifest: Record<string, unknown>, client: string) => {
    const directory = path.join(root, id);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'mod.json'), JSON.stringify({
        folium: 1, id, name: id, version: '1.0.0', client: 'client.mjs', ...manifest,
    }));
    fs.writeFileSync(path.join(directory, 'client.mjs'), client);
    return directory;
};

describe('mods/folium.d.ts', () => {
    it('matches the contract (run `npm run folium:types` after changing contract.ts)', () => {
        const expected = renderFoliumTypes(fs.readFileSync(CONTRACT_PATH, 'utf8'), fs.readFileSync(MAIN_CONTRACT_PATH, 'utf8'));
        expect(fs.readFileSync(TYPES_PATH, 'utf8')).toBe(expected);
        // What makes it usable from a mod with no build step.
        expect(expected).not.toMatch(/^import\s/m);
    });

    it('refuses a contract it cannot turn into a type file', () => {
        expect(() => renderFoliumTypes('import x from "y";\nexport type A = string;\n')).toThrow('must import nothing');
        expect(() => renderFoliumTypes('export function run() {}\n')).toThrow('cannot hold');
        expect(() => renderFoliumTypes('export const V = Object.freeze({ major: 1, limits: [1, 2] });\n')).toThrow('not a plain "name: value" member');
        expect(() => renderFoliumTypes('export type A = string;\n', 'import type { X } from \'./other\';\nexport type B = X;\n'))
            .toThrow('may import only types of ./contract');
    });

    it('takes the main contract after the contract, without its import of the contract\'s types', () => {
        const types = renderFoliumTypes('export type A = string;\n', 'import type { A } from \'./contract\';\n\nexport type B = A;\n');
        expect(types).not.toMatch(/^import\s/m);
        expect(types.indexOf('export type A = string;')).toBeLessThan(types.indexOf('export type B = A;'));
    });

    it('writes the same declaration for a constant however its members are laid out', () => {
        const plain = renderFoliumTypes('export const V = Object.freeze({ major: 1, minor: 5 });\n');
        expect(plain).toContain('export declare const V: { readonly major: 1; readonly minor: 5 };');
        expect(renderFoliumTypes('export const V = Object.freeze({ major: 1, minor: 5, });\n')).toBe(plain);
        expect(renderFoliumTypes('export const V = Object.freeze({\n    major: 1,\n    minor: 5,\n});\n')).toBe(plain);
    });
});

describe('folium:new', () => {
    it('writes a mod that folium:check finds no problem in, and never into a folder that is there', () => {
        const directory = path.join(root, 'my-first-mod');
        const checked = createFoliumMod(directory);
        expect(checked.problems).toEqual([]);
        expect(checked.manifest).toMatchObject({ id: 'my-first-mod', client: 'client.mjs' });
        expect(fs.readdirSync(directory).sort()).toEqual(['client.mjs', 'mod.json']);

        expect(() => createFoliumMod(directory)).toThrow('already there');
        expect(() => createFoliumMod(path.join(root, 'My Mod'))).toThrow('cannot be a mod id');
        expect(fs.existsSync(path.join(root, 'My Mod'))).toBe(false);
    });

    it('with --main also writes a main entry and a command that calls it, and the check finds no problem', () => {
        const directory = path.join(root, 'with-main');
        const checked = createFoliumMod(directory, { main: true });
        expect(checked.problems).toEqual([]);
        expect(checked.manifest).toMatchObject({ main: 'index.cjs', client: 'client.mjs' });
        expect(fs.readdirSync(directory).sort()).toEqual(['client.mjs', 'index.cjs', 'mod.json']);
        expect(fs.readFileSync(path.join(directory, 'index.cjs'), 'utf8')).toContain('api.rpc.handle(\'hello\'');
        expect(fs.readFileSync(path.join(directory, 'client.mjs'), 'utf8')).toContain('folium.rpc.call(\'hello\')');
    });

    it('outside the repository, puts a copy of the type file next to the mod folder, where the entries look for it', () => {
        const first = createFoliumMod(path.join(root, 'outside-one'), { main: true });
        const copy = path.join(root, 'folium.d.ts');
        expect(first.written).toContain(copy);
        expect(fs.readFileSync(copy, 'utf8')).toBe(fs.readFileSync(TYPES_PATH, 'utf8'));
        expect(typesImportFor(path.join(root, 'outside-one'))).toEqual({ path: '../folium', copyTo: copy });
        expect(fs.readFileSync(path.join(root, 'outside-one', 'index.cjs'), 'utf8')).toContain('import(\'../folium\').FoliumMainApi');
        // One that is there already is kept.
        fs.writeFileSync(copy, '// mine\n');
        expect(createFoliumMod(path.join(root, 'outside-two')).written).not.toContain(copy);
        expect(fs.readFileSync(copy, 'utf8')).toBe('// mine\n');
        // Inside the repository the entries point at mods/folium.d.ts and nothing is copied.
        expect(typesImportFor(resolveModFolder('some-mod'))).toEqual({ path: '../folium', copyTo: null });
    });

    it('names the command that checks the mod again in the form that works for where it is', () => {
        expect(checkCommandFor(resolveModFolder('some-mod'))).toBe('npm run folium:check some-mod');
        const outside = path.join(root, 'a mod');
        expect(checkCommandFor(outside)).toMatch(/^node \S*dev\/folium\/check\.mjs "/);
        expect(checkCommandFor(outside).endsWith(` "${outside}"`)).toBe(true);
    });
});

describe('folium:check', () => {
    it('reports a manifest the app would refuse, in the app\'s own words', () => {
        const directory = writeMod('bad-manifest', { folium: 2, permissions: ['everything'] }, 'export default function activate() {}\n');
        const { ok, problems } = checkFoliumMod(directory);
        expect(ok).toBe(false);
        expect(problems).toEqual([
            'mod.json: unsupported folium version 2; this host implements folium 1',
            'mod.json: unknown or unsupported permission everything',
        ]);
    });

    it('finds a file the manifest names that is not there, and a client entry with no default export', () => {
        const directory = writeMod('missing-files', { main: 'index.cjs', preview: 'preview.png' }, 'export function activate() {}\n');
        expect(checkFoliumMod(directory).problems).toEqual([
            'mod.json names "index.cjs" as its main, and that file is not in the folder',
            'mod.json names "preview.png" as its preview, and that file is not in the folder',
            'client.mjs has no default export: the app calls its default export as activate(folium)',
        ]);
    });

    it('holds the registries and experimental surfaces the code uses to the kinds table and to mod.json', () => {
        const directory = writeMod('wrong-names', {}, `
            import { more } from './more.mjs';
            export default function activate(folium) {
                folium.registries.visualizers.register({ id: 'a', label: {}, mount() {} });
                folium.registries.toolbarButtons.register({ id: 'b' });
                folium.experimental['omni.providers'].register({ id: 'c' });
                folium.experimental['omni.everything'].register({ id: 'd' });
                more(folium);
            }
        `);
        // A file the entry imports is read too.
        fs.writeFileSync(path.join(directory, 'more.mjs'), 'export const more = (folium) => folium.registries.stageLayers.register({ id: "e" });\n');
        const { problems } = checkFoliumMod(directory);
        expect(problems).toHaveLength(4);
        expect(problems[0]).toContain('folium.registries has no "toolbarButtons"');
        expect(problems[1]).toBe('folium.registries.stageLayers needs the permission "stageLayers" in mod.json');
        expect(problems[2]).toBe('folium.experimental[\'omni.providers\'] needs "omni.providers" under "experimental" in mod.json');
        expect(problems[3]).toContain('folium.experimental has no "omni.everything"');

        // Declared, the same code has nothing against it but the two names that do not exist.
        fs.writeFileSync(path.join(directory, 'mod.json'), JSON.stringify({
            folium: 1, id: 'wrong-names', name: 'wrong-names', version: '1.0.0', client: 'client.mjs',
            permissions: ['stageLayers'], experimental: ['omni.providers'],
        }));
        expect(checkFoliumMod(directory).problems).toHaveLength(2);
    });

    it('reads a default export as the app does: an object or a commented one is none, a re-export is one', () => {
        const object = writeMod('object-default', {}, 'export default { activate(folium) {} };\n');
        expect(checkFoliumMod(object).problems).toEqual([
            'client.mjs exports an object as its default: the app calls the default export itself as activate(folium), so it has to be a function',
        ]);
        const commented = writeMod('commented-default', {}, '// export default function activate() {}\nexport const activate = () => {};\n');
        expect(checkFoliumMod(commented).problems).toEqual([
            'client.mjs has no default export: the app calls its default export as activate(folium)',
        ]);
        const forwarded = writeMod('forwarded-default', {}, 'export { default } from \'./impl.mjs\';\n');
        fs.writeFileSync(path.join(forwarded, 'impl.mjs'), 'export default function activate() {}\n');
        expect(checkFoliumMod(forwarded).problems).toEqual([]);
    });

    it('does not count names in comments and strings, and holds an unknown registry a problem however the code reaches it', () => {
        const directory = writeMod('only-mentions', {}, `
            // folium.registries.toolbarButtons.register({ id: 'x' }) is planned for later.
            /* folium.experimental['omni.hooks'].on(...) and folium.storage.get('k') too. */
            export default function activate(folium) {
                console.log("see folium.experimental['omni.hooks'], folium.net.fetch and folium.registries.stageLayers.register");
                folium.registries.futureKind?.register({ id: 'a' });
                if ('laterKind' in folium.registries) folium.registries.laterKind.register({ id: 'b' });
            }
        `);
        const { problems } = checkFoliumMod(directory);
        expect(problems).toHaveLength(2);
        expect(problems[0]).toContain('folium.registries has no "futureKind"');
        expect(problems[1]).toContain('folium.registries has no "laterKind"');
    });

    it('holds the members a permission guards, in the client code and in the main code, to the permissions in mod.json', () => {
        const directory = writeMod('guarded-members', { main: 'index.cjs' }, `
            export default async function activate(folium) {
                const saved = await folium.storage.get('k');
                if (folium.playback.getState().playing) folium.playback.play();
                folium.playback.playSong?.(saved);
                await folium.net?.fetch('https://example.com');
            }
        `);
        fs.writeFileSync(path.join(directory, 'index.cjs'), `
            // api.render.exportVideo is mentioned here only in a comment.
            const { snapshot } = require('./snapshot');
            module.exports = function activate(api) {
                api.rpc.handle('save', (value) => api.storage.set('k', value));
                api.rpc.handle('now', () => snapshot(api));
            };
        `);
        // A file the main entry requires is read too, with the extension Node would add.
        fs.writeFileSync(path.join(directory, 'snapshot.cjs'), 'exports.snapshot = (api) => api.runtime.getPlaybackSnapshot();\n');
        expect(checkFoliumMod(directory).problems).toEqual([
            'folium.storage needs the permission "filesystem.data" in mod.json',
            'folium.playback.play needs the permission "playback.control" in mod.json',
            'folium.playback.playSong needs the permission "playback.control" in mod.json',
            'folium.net.fetch needs the permission "net.fetch" in mod.json',
            'api.storage needs the permission "filesystem.data" in mod.json',
            'api.runtime.getPlaybackSnapshot needs the permission "playback.read" in mod.json',
        ]);

        const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'mod.json'), 'utf8'));
        fs.writeFileSync(path.join(directory, 'mod.json'), JSON.stringify({
            ...manifest, permissions: ['filesystem.data', 'playback.read', 'playback.control', 'net.fetch'],
        }));
        expect(checkFoliumMod(directory).problems).toEqual([]);
    });

    it('holds the events the code listens to to the event types table and to the experimental opt-ins', () => {
        const directory = writeMod('events', {}, `
            export default function activate(folium, kind) {
                folium.events.on('lyrics.transform', (event) => {});
                folium.events.on('lyrics.changed', () => {});
                folium.events?.on("omni.lyricsResolved", () => {});
                folium.events.on(\`playback.\${kind}\`, () => {});
            }
        `);
        const { problems } = checkFoliumMod(directory);
        expect(problems).toHaveLength(2);
        expect(problems[0]).toContain('folium.events has no "lyrics.changed" event');
        expect(problems[1]).toBe('folium.events.on(\'omni.lyricsResolved\') needs "omni.hooks" under "experimental" in mod.json');
    });

    it('sees a registry or an experimental surface reached with ?. or with brackets', () => {
        const directory = writeMod('other-access', {}, `
            export default function activate(folium) {
                folium.registries.stageLayers?.register({ id: 'a' });
                folium.registries['playerPanelTabs'].register({ id: 'b' });
                folium.experimental[\`omni.providers\`].register({ id: 'c' });
                folium.experimental?.["omni.hooks"].on('lyricsResolved', () => {});
            }
        `);
        expect(checkFoliumMod(directory).problems).toEqual([
            'folium.registries.stageLayers needs the permission "stageLayers" in mod.json',
            'folium.experimental[\'omni.providers\'] needs "omni.providers" under "experimental" in mod.json',
            'folium.experimental[\'omni.hooks\'] needs "omni.hooks" under "experimental" in mod.json',
        ]);
    });

    it('holds the platforms platform.raw requests to the read permissions in mod.json', () => {
        const client = `
            export default async function activate(folium) {
                const platform = folium.experimental['platform.raw'];
                platform.describe('netease');
                await platform.request('netease', 'user_record', { type: 1 });
                await folium.experimental['platform.raw']?.request("nowhere", 'x');
            }
        `;
        const without = writeMod('raw-without', { experimental: ['platform.raw'] }, client);
        expect(checkFoliumMod(without).problems).toEqual([
            'folium.experimental[\'platform.raw\'].request(\'netease\', …) needs the permission "platform.netease.read" in mod.json',
            'folium.experimental[\'platform.raw\'] cannot call "nowhere": no platform of that id has raw endpoints',
        ]);
        const declared = writeMod('raw-declared', { experimental: ['platform.raw'], permissions: ['platform.netease.read'] }, client.replace(/.*nowhere.*\n/, ''));
        expect(checkFoliumMod(declared).problems).toEqual([]);
        // The platform id is not written out: nothing to hold to a permission, so a note says what is missing.
        const indirect = writeMod('raw-indirect', { experimental: ['platform.raw'] }, `
            export default function activate(folium, id) { return folium.experimental['platform.raw'].request(id, 'user_record'); }
        `);
        const { problems, notes } = checkFoliumMod(indirect);
        expect(problems).toEqual([]);
        expect(notes.some((note) => note.includes('declares no platform.<platform>.read permission'))).toBe(true);
    });

    it('reports a Folia version the app would refuse, and names the mods it depends on without checking them', () => {
        const directory = writeMod('wrong-host', { folia: '>=99.0.0', depends: ['some-library@^1.0.0'] }, 'export default function activate() {}\n');
        const { problems, notes } = checkFoliumMod(directory);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain('mod.json asks for Folia ">=99.0.0"');
        expect(notes.some((note) => note.startsWith('depends on some-library@^1.0.0'))).toBe(true);
    });

    it('takes a bare name as a folder under mods/, with or without a separator at its end', () => {
        const under = resolveModFolder('my-mod');
        expect(under.replace(/\\/g, '/')).toMatch(/\/mods\/my-mod$/);
        expect(resolveModFolder('my-mod/')).toBe(under);
        // A name that is also a folder of the repository is still a name.
        expect(resolveModFolder('docs').replace(/\\/g, '/')).toMatch(/\/mods\/docs$/);
        expect(resolveModFolder('./my-mod')).toBe(path.resolve('my-mod'));
    });

    it('says whether the mod is signed, and that an unsigned one is not a problem, nor one with no preview', () => {
        const directory = writeMod('unsigned', {}, 'export default function activate() {}\n');
        const { ok, notes } = checkFoliumMod(directory);
        expect(ok).toBe(true);
        expect(notes.some((note) => note.startsWith('not signed'))).toBe(true);
        expect(notes.some((note) => note.startsWith('mod.json has no "preview"'))).toBe(true);
    });
});

import { readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// test/unit/electron/powershellScripts.test.ts - the PowerShell Folia runs is plain files, never a
// script typed out on the command line. A command line that carries -EncodedCommand (or a script as
// -Command text) reads to antivirus software as a script a program made up to run, and a security
// suite flags every start of it. Each script lives in the repository as a .ps1 and is handed over as
// -File with named parameters, so what runs is a file on disk that can be read, signed and scanned.

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

/** A repository path, spelled the way this platform spells it. */
const at = (...parts: string[]) => join(ROOT, ...parts);

/** The PowerShell Folia ships, as the file each caller names. */
const SCRIPTS = {
    mediaSession: 'electron/spotify/scripts/mediaSession.ps1',
    windowWatch: 'electron/spotify/scripts/windowWatch.ps1',
    windowSweep: 'electron/spotify/scripts/windowSweep.ps1',
    listProcesses: 'electron/ytm/scripts/listProcesses.ps1',
} as const;

/** The two modules that start PowerShell. */
const CALLERS = ['electron/spotify/officialClient.cjs', 'electron/ytm/browserSignIn.cjs'];

const read = (file: string) => readFileSync(at(...file.split('/')), 'utf8');

describe('the PowerShell Folia runs', () => {
    it('ships every script as a readable file of its own', () => {
        for (const file of Object.values(SCRIPTS)) {
            const text = read(file);
            // A script on disk is what antivirus software can inspect and what a listener can read.
            expect(text.length, file).toBeGreaterThan(0);
            expect(text, file).toMatch(/^\uFEFF?(param\s*\(|\$ErrorActionPreference|#)/);
            // Every script is a file of its own: none of them is built from another one in code.
            expect(text, file).not.toContain('__FOLIA_PARAM__');
        }
    });

    it('hands the script over as a file, with no encoded or typed-out command line', () => {
        for (const file of CALLERS) {
            const text = read(file);
            // A base64 command line is exactly the shape a security suite takes for a made-up script.
            expect(text, file).not.toContain('-EncodedCommand');
            expect(text, file).not.toContain('toString(\'base64\')');
            // No script text is handed over as -Command either.
            expect(text, file).not.toMatch(/-Command/);
        }
    });

    it('names each script by the file it is, and passes nothing of it as text', () => {
        const client = read('electron/spotify/officialClient.cjs');
        for (const name of ['mediaSession.ps1', 'windowWatch.ps1', 'windowSweep.ps1']) {
            expect(client, name).toContain(name);
        }
        expect(read('electron/ytm/browserSignIn.cjs')).toContain('listProcesses.ps1');
    });

    it('takes everything a script needs as a named parameter, never as part of its text', () => {
        // The watcher is the one script that is told something: which PIDs are the listener's, and how
        // long it may live. Both are parameters of the file.
        const watcher = read(SCRIPTS.windowWatch);
        expect(watcher).toContain('[string] $SkipPids');
        expect(watcher).toContain('[int] $LifetimeMs');
        const sweep = read(SCRIPTS.windowSweep);
        expect(sweep).toContain('[string] $SkipPids');
        // The process list names no folder of its own: it comes in on the environment, where a folder
        // that holds a space needs no quoting at all.
        expect(read(SCRIPTS.listProcesses)).toContain('$env:FOLIA_SIGN_IN_FOLDER');
    });

    it('keeps the media session helper a JSON line reader over its standard input', () => {
        // The helper is one process for a whole run: it reads one command a line and answers one line.
        // A script file must not change that, or every read would start a PowerShell of its own.
        const smtc = read(SCRIPTS.mediaSession);
        expect(smtc).toContain('[Console]::In.ReadLine()');
        expect(smtc).toContain('ConvertFrom-Json');
        expect(smtc).toContain('ConvertTo-Json');
    });

    it('packs every script outside the asar archive', () => {
        // PowerShell cannot read a path inside app.asar: the scripts have to be real files beside it.
        const build = (JSON.parse(read('package.json')) as { build: { asarUnpack: string[]; files: string[] } }).build;
        const unpacked = build.asarUnpack.map(pattern => pattern.split('/'));
        for (const file of Object.values(SCRIPTS)) {
            const parts = file.split('/');
            expect(build.files.some(pattern => parts.join('/').startsWith(pattern.replace('**/*', ''))), file).toBe(true);
            // At least one asarUnpack pattern covers the folder the script sits in.
            const covered = unpacked.some(pattern => {
                const folder = pattern.slice(0, -2);
                return folder.every((part, index) => parts[index] === part);
            });
            expect(covered, file + ' must be unpacked, or PowerShell cannot read it').toBe(true);
        }
    });
});

describe('a script packed outside the asar archive', () => {
    it('is looked for under app.asar.unpacked when the app is packaged', async () => {
        const { powershellScriptPath } = await import('../../../electron/powershellScripts.cjs') as {
            powershellScriptPath: (dir: string, name: string) => string;
        };
        const packaged = join(ROOT, 'resources', 'app.asar', 'electron', 'spotify');
        expect(powershellScriptPath(packaged, 'windowWatch.ps1')).toBe(join(ROOT, 'resources', 'app.asar.unpacked', 'electron', 'spotify', 'windowWatch.ps1'));
        // A tree that is not an archive is left as it is: that is the repository, and a build unpacked whole.
        const dev = join(ROOT, 'electron', 'spotify');
        expect(powershellScriptPath(dev, 'windowWatch.ps1')).toBe(join(dev, 'windowWatch.ps1'));
        // Only the archive segment is rewritten.
        expect(relative(ROOT, powershellScriptPath(join(ROOT, 'x', 'app.asar'), 'a.ps1')).split(sep).join('/'))
            .toBe('x/app.asar.unpacked/a.ps1');
    });
});

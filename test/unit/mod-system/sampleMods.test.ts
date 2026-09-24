import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

// test/unit/mod-system/sampleMods.test.ts
// Every mod shipped in the repository's mods/ directory is Folium 1: its
// manifest validates and the entry files it declares exist. Samples are the
// first thing mod authors copy, so they must never drift from the contract.

const require = createRequire(import.meta.url);
const { validateManifest } = require('../../../electron/modSystem/manifest.cjs');

const MODS_DIR = path.resolve(__dirname, '../../../mods');
const modDirectories = fs.readdirSync(MODS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => path.join(MODS_DIR, entry.name));

describe('repository sample mods', () => {
    it('has samples to check', () => {
        expect(modDirectories.length).toBeGreaterThan(0);
    });

    it.each(modDirectories.map((directory) => [path.basename(directory), directory]))('%s is a valid Folium 1 mod', (_name, directory) => {
        const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'mod.json'), 'utf8'));
        const result = validateManifest(manifest);
        expect(result.ok ? [] : result.errors).toEqual([]);
        if (!result.ok) return;
        if (result.value.main) expect(fs.existsSync(path.join(directory, result.value.main))).toBe(true);
        if (result.value.client) {
            const clientPath = path.join(directory, result.value.client);
            expect(fs.existsSync(clientPath)).toBe(true);
            expect(fs.readFileSync(clientPath, 'utf8')).toMatch(/export default function activate\(folium\)/);
        }
    });
});

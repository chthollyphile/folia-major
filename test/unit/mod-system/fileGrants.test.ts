import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

// test/unit/mod-system/fileGrants.test.ts
// Persistent file grants (folium.ui.pickFile({ persist }) / restoreFile): a
// grant resolves only for the mod that holds it and only while its file
// exists, survives a new store instance (an app restart), and is capped per mod.

const require = createRequire(import.meta.url);
const { createFileGrantStore } = require('../../../electron/modSystem/fileGrants.cjs');

const temporaryDirectories: string[] = [];

const tempFile = (name = 'clip.mp4') => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-file-grants-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, name);
    fs.writeFileSync(filePath, 'data');
    return filePath;
};

// One persisted record shared by every store instance, like electron-store across restarts.
const createPersistence = () => {
    const records = new Map<string, unknown>();
    return {
        records,
        readGrants: (modId: string) => records.get(modId),
        writeGrants: (modId: string, grants: unknown) => { records.set(modId, JSON.parse(JSON.stringify(grants))); },
    };
};

afterEach(() => {
    while (temporaryDirectories.length > 0) {
        fs.rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
    }
});

describe('file grants', () => {
    it('resolves a grant for its own mod after a restart', () => {
        const persistence = createPersistence();
        const filePath = tempFile();
        const grantId = createFileGrantStore(persistence).add('mod-a', filePath);
        expect(grantId).toMatch(/^[0-9a-f]{32}$/);
        expect(createFileGrantStore(persistence).resolve('mod-a', grantId)).toBe(filePath);
    });

    it('never resolves another mod\'s grant or a malformed id', () => {
        const store = createFileGrantStore(createPersistence());
        const grantId = store.add('mod-a', tempFile());
        expect(store.resolve('mod-b', grantId)).toBeNull();
        expect(store.resolve('mod-a', '__proto__')).toBeNull();
        expect(store.resolve('mod-a', 42)).toBeNull();
    });

    it('drops a grant whose file is gone', () => {
        const persistence = createPersistence();
        const store = createFileGrantStore(persistence);
        const filePath = tempFile();
        const grantId = store.add('mod-a', filePath);
        fs.rmSync(filePath);
        expect(store.resolve('mod-a', grantId)).toBeNull();
        expect(persistence.records.get('mod-a')).toEqual({});
    });

    it('releases a grant once', () => {
        const store = createFileGrantStore(createPersistence());
        const grantId = store.add('mod-a', tempFile());
        expect(store.release('mod-b', grantId)).toBe(false);
        expect(store.release('mod-a', grantId)).toBe(true);
        expect(store.release('mod-a', grantId)).toBe(false);
        expect(store.resolve('mod-a', grantId)).toBeNull();
    });

    it('keeps at most the newest grants per mod', () => {
        const store = createFileGrantStore({ ...createPersistence(), maxGrantsPerMod: 2 });
        const filePath = tempFile();
        const first = store.add('mod-a', filePath);
        const second = store.add('mod-a', filePath);
        const third = store.add('mod-a', filePath);
        expect(store.resolve('mod-a', first)).toBeNull();
        expect(store.resolve('mod-a', second)).toBe(filePath);
        expect(store.resolve('mod-a', third)).toBe(filePath);
    });

    it('treats an unreadable record as empty', () => {
        const store = createFileGrantStore({
            readGrants: () => { throw new Error('corrupt'); },
            writeGrants: () => { throw new Error('read-only'); },
        });
        const grantId = store.add('mod-a', tempFile());
        expect(store.resolve('mod-a', grantId)).toBeNull();
    });
});

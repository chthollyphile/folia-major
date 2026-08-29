import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

// test/unit/mod-system/modDigest.test.ts
// The digest is what binds a user's "enable this mod" confirmation to a
// specific set of bytes, so the properties that matter are: identical trees
// hash the same, any change to any file changes the hash, and an unhashable
// tree reports null rather than a value that could be trusted.

const require = createRequire(import.meta.url);
const { computeModDigest, shortDigest, DIGEST_LIMITS } = require('../../../electron/modSystem/modDigest.cjs');

const temporaryDirectories: string[] = [];

const makeModDirectory = (files: Record<string, string>): string => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-mod-digest-'));
    temporaryDirectories.push(root);
    Object.entries(files).forEach(([relative, contents]) => {
        const absolute = path.join(root, relative);
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.writeFileSync(absolute, contents);
    });
    return root;
};

afterEach(() => {
    while (temporaryDirectories.length > 0) {
        fs.rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
    }
});

describe('computeModDigest', () => {
    it('is stable for identical trees', () => {
        const files = { 'mod.json': '{"id":"a"}', 'index.cjs': 'module.exports = () => {};' };
        expect(computeModDigest(makeModDirectory(files))).toBe(computeModDigest(makeModDirectory(files)));
    });

    it('changes when a file changes', () => {
        const directory = makeModDirectory({ 'mod.json': '{"id":"a"}', 'index.cjs': 'module.exports = () => {};' });
        const before = computeModDigest(directory);
        fs.writeFileSync(path.join(directory, 'index.cjs'), 'module.exports = () => { steal(); };');
        expect(computeModDigest(directory)).not.toBe(before);
    });

    it('changes when a file is added', () => {
        const directory = makeModDirectory({ 'mod.json': '{"id":"a"}' });
        const before = computeModDigest(directory);
        fs.writeFileSync(path.join(directory, 'extra.js'), 'export default 1;');
        expect(computeModDigest(directory)).not.toBe(before);
    });

    it('changes when a file only moves between paths', () => {
        const first = computeModDigest(makeModDirectory({ 'a/one.js': 'x', 'b/two.js': 'y' }));
        const second = computeModDigest(makeModDirectory({ 'a/two.js': 'x', 'b/one.js': 'y' }));
        expect(first).not.toBe(second);
    });

    it('returns null for a missing directory', () => {
        expect(computeModDigest(path.join(os.tmpdir(), 'folia-mod-digest-does-not-exist'))).toBeNull();
        expect(computeModDigest('')).toBeNull();
        expect(computeModDigest(null)).toBeNull();
    });

    it('returns null for a tree past the file-count limit', () => {
        const files: Record<string, string> = {};
        for (let index = 0; index <= DIGEST_LIMITS.maxFiles; index += 1) {
            files[`file-${index}.txt`] = String(index);
        }
        expect(computeModDigest(makeModDirectory(files))).toBeNull();
    });
});

describe('shortDigest', () => {
    it('shortens a digest and reports unknown for a missing one', () => {
        const digest = computeModDigest(makeModDirectory({ 'mod.json': '{}' }));
        expect(shortDigest(digest)).toHaveLength(12);
        expect(digest.startsWith(`sha256:${shortDigest(digest)}`)).toBe(true);
        expect(shortDigest(null)).toBe('unknown');
    });
});

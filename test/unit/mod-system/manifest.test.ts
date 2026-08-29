import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';

// test/unit/mod-system/manifest.test.ts
// Focused unit coverage for the pure manifest validation and dependency
// resolution helpers of the mod loader. No Electron imports are involved.

const require = createRequire(import.meta.url);
const {
    validateManifest,
    resolveLoadOrder,
    resolveLoadPlan,
    satisfiesRange,
    parseDependency,
} = require('../../../electron/modSystem/manifest.cjs');

const validManifest = {
    id: 'transparent-mov-export',
    name: 'Transparent MOV Export',
    version: '1.0.0',
    apiVersion: 1,
    entry: 'index.cjs',
    depends: [],
    permissions: ['render.export'],
};

describe('validateManifest', () => {
    it('accepts a minimal valid manifest and normalizes defaults', () => {
        const result = validateManifest(validManifest);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.author).toBeNull();
            expect(result.value.apiVersion).toBe(1);
        }
    });

    it('rejects a missing id', () => {
        const result = validateManifest({ ...validManifest, id: undefined });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors.join()).toContain('mod.id');
        }
    });

    it('rejects an id with invalid characters', () => {
        const result = validateManifest({ ...validManifest, id: 'Bad Id!' });
        expect(result.ok).toBe(false);
    });

    it('rejects a non-semver version', () => {
        const result = validateManifest({ ...validManifest, version: 'one-point-oh' });
        expect(result.ok).toBe(false);
    });

    it('rejects an unsupported apiVersion', () => {
        const result = validateManifest({ ...validManifest, apiVersion: 99 });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors.join()).toContain('apiVersion');
        }
    });

    it('rejects an entry path that escapes the mod directory', () => {
        const result = validateManifest({ ...validManifest, entry: '../index.cjs' });
        expect(result.ok).toBe(false);
    });

    it('rejects unknown permissions (fail closed)', () => {
        const result = validateManifest({ ...validManifest, permissions: ['raw-domain-access'] });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors.join()).toContain('permission');
        }
    });

    it('rejects duplicate permissions', () => {
        const result = validateManifest({ ...validManifest, permissions: ['render.export', 'render.export'] });
        expect(result.ok).toBe(false);
    });
});

describe('parseDependency / satisfiesRange', () => {
    it('parses a bare id dependency', () => {
        expect(parseDependency('base-mod')).toEqual({ ok: true, id: 'base-mod', range: null });
    });

    it('parses a caret range dependency', () => {
        expect(parseDependency('base-mod@^1.2.3')).toEqual({ ok: true, id: 'base-mod', range: '^1.2.3' });
    });

    it('rejects an unsupported range operator', () => {
        expect(parseDependency('base-mod@~1.2.3').ok).toBe(false);
    });

    it('matches caret ranges within the same major', () => {
        expect(satisfiesRange('1.4.0', '^1.2.3')).toBe(true);
        expect(satisfiesRange('1.2.3', '^1.2.3')).toBe(true);
        expect(satisfiesRange('2.0.0', '^1.2.3')).toBe(false);
        expect(satisfiesRange('1.1.9', '^1.2.3')).toBe(false);
    });

    it('treats a wildcard as always satisfied', () => {
        expect(satisfiesRange('0.0.1', '*')).toBe(true);
        expect(satisfiesRange('9.9.9', null)).toBe(true);
    });
});

describe('validateManifest visualizers contribution', () => {
    it('accepts a valid visualizer contribution with the permission', () => {
        const result = validateManifest({
            ...validManifest,
            permissions: ['visualizer.register'],
            visualizers: [{ id: 'aurora-text', entry: 'visualizer.mjs', label: { 'zh-CN': '虹光' } }],
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.visualizers).toHaveLength(1);
            expect(result.value.visualizers[0].order).toBe(500);
        }
    });

    it('rejects a visualizer without the visualizer.register permission', () => {
        const result = validateManifest({
            ...validManifest,
            visualizers: [{ id: 'aurora-text', entry: 'visualizer.mjs' }],
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors.join()).toContain('visualizer.register');
        }
    });

    it('rejects traversal entries and duplicate ids', () => {
        const result = validateManifest({
            ...validManifest,
            permissions: ['visualizer.register'],
            visualizers: [
                { id: 'a', entry: '../escape.mjs' },
                { id: 'a', entry: 'v.mjs' },
            ],
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors.join()).toContain('relative .js/.mjs path');
            expect(result.errors.join()).toContain('duplicate');
        }
    });

    it('treats a missing visualizers field as no contribution', () => {
        const result = validateManifest(validManifest);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.visualizers).toEqual([]);
        }
    });
});

describe('resolveLoadOrder', () => {
    const manifestFor = (id: string, depends: string[] = []) => ({
        id,
        name: id,
        version: '1.0.0',
        apiVersion: 1,
        entry: 'index.cjs',
        depends,
        permissions: [],
    });

    it('orders dependencies before dependents', () => {
        const manifests = new Map([
            ['app', manifestFor('app', ['base'])],
            ['base', manifestFor('base')],
        ]);
        const result = resolveLoadOrder(manifests);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.order.indexOf('base')).toBeLessThan(result.order.indexOf('app'));
        }
    });

    it('reports a missing dependency', () => {
        const manifests = new Map([['app', manifestFor('app', ['ghost'])]]);
        const result = resolveLoadOrder(manifests);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors.join()).toContain('ghost');
        }
    });

    it('reports an unsatisfied version range', () => {
        const manifests = new Map([
            ['app', manifestFor('app', ['base@^2.0.0'])],
            ['base', manifestFor('base')],
        ]);
        const result = resolveLoadOrder(manifests);
        expect(result.ok).toBe(false);
    });

    it('reports a dependency cycle', () => {
        const manifests = new Map([
            ['a', manifestFor('a', ['b'])],
            ['b', manifestFor('b', ['a'])],
        ]);
        const result = resolveLoadOrder(manifests);
        expect(result.ok).toBe(false);
    });

    it('resolves an empty set trivially', () => {
        const result = resolveLoadOrder(new Map());
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.order).toEqual([]);
        }
    });
});

describe('resolveLoadPlan', () => {
    const manifestFor = (id: string, depends: string[] = []) => ({
        id,
        name: id,
        version: '1.0.0',
        apiVersion: 1,
        entry: 'index.cjs',
        depends,
        permissions: [],
    });

    it('confines a missing dependency to the mod that declared it', () => {
        const manifests = new Map([
            ['healthy', manifestFor('healthy')],
            ['broken', manifestFor('broken', ['ghost'])],
        ]);
        const plan = resolveLoadPlan(manifests, { roots: ['healthy', 'broken'] });
        expect(plan.order).toEqual(['healthy']);
        expect(plan.failures.has('healthy')).toBe(false);
        expect(plan.failures.get('broken')?.join()).toContain('ghost');
    });

    it('confines a dependency cycle to the mods inside it', () => {
        const manifests = new Map([
            ['a', manifestFor('a', ['b'])],
            ['b', manifestFor('b', ['a'])],
            ['healthy', manifestFor('healthy')],
        ]);
        const plan = resolveLoadPlan(manifests, { roots: ['a', 'b', 'healthy'] });
        expect(plan.order).toEqual(['healthy']);
        expect(plan.failures.has('a')).toBe(true);
        expect(plan.failures.has('b')).toBe(true);
        expect(plan.failures.has('healthy')).toBe(false);
    });

    it('never resolves a mod that is not a root', () => {
        const manifests = new Map([
            ['enabled', manifestFor('enabled')],
            ['disabled-and-broken', manifestFor('disabled-and-broken', ['ghost'])],
        ]);
        const plan = resolveLoadPlan(manifests, { roots: ['enabled'] });
        expect(plan.order).toEqual(['enabled']);
        expect(plan.failures.size).toBe(0);
    });

    it('fails a mod whose dependency is not enabled instead of loading it unconfirmed', () => {
        const manifests = new Map([
            ['app', manifestFor('app', ['base'])],
            ['base', manifestFor('base')],
        ]);
        const plan = resolveLoadPlan(manifests, {
            roots: ['app'],
            isEnabled: (modId: string) => modId === 'app',
        });
        expect(plan.order).toEqual([]);
        expect(plan.failures.get('app')?.join()).toContain('not enabled');
    });

    it('propagates a failed dependency to its dependents only', () => {
        const manifests = new Map([
            ['leaf', manifestFor('leaf', ['ghost'])],
            ['middle', manifestFor('middle', ['leaf'])],
            ['unrelated', manifestFor('unrelated')],
        ]);
        const plan = resolveLoadPlan(manifests, { roots: ['middle', 'unrelated'] });
        expect(plan.order).toEqual(['unrelated']);
        expect(plan.failures.has('leaf')).toBe(true);
        expect(plan.failures.has('middle')).toBe(true);
        expect(plan.failures.has('unrelated')).toBe(false);
    });
});

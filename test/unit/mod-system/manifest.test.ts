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
    satisfiesHostRange,
    parseDependency,
} = require('../../../electron/modSystem/manifest.cjs');

const validManifest = {
    folium: 1,
    id: 'transparent-mov-export',
    name: 'Transparent MOV Export',
    version: '1.0.0',
    main: 'index.cjs',
    depends: [],
    permissions: ['render.export'],
};

describe('validateManifest', () => {
    it('accepts a minimal valid manifest and normalizes defaults', () => {
        const result = validateManifest(validManifest);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.author).toBeNull();
            expect(result.value.folium).toBe(1);
            expect(result.value.client).toBeNull();
            expect(result.value.experimental).toEqual([]);
            expect(result.value.embedOrigins).toEqual([]);
            expect(result.value.folia).toBeNull();
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

    it('rejects an unsupported folium version', () => {
        const result = validateManifest({ ...validManifest, folium: 2 });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors.join()).toContain('folium');
        }
    });

    it('rejects a main path that escapes the mod directory', () => {
        const result = validateManifest({ ...validManifest, main: '../index.cjs' });
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

describe('validateManifest Folium entries and opt-ins', () => {
    it('rejects the pre-Folium fields with a pointed message', () => {
        const result = validateManifest({
            ...validManifest,
            apiVersion: 1,
            entry: 'index.cjs',
            visualizers: [{ id: 'a', entry: 'v.mjs' }],
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            const joined = result.errors.join('\n');
            expect(joined).toContain('apiVersion-replaced-by-folium');
            expect(joined).toContain('entry-replaced-by-main');
            expect(joined).toContain('visualizers-moved-to-client');
        }
    });

    it('accepts a client-only mod and requires at least one entry', () => {
        const clientOnly = { ...validManifest, main: undefined, client: 'client.mjs', permissions: [] };
        expect(validateManifest(clientOnly).ok).toBe(true);
        const noEntry = { ...validManifest, main: undefined };
        const result = validateManifest(noEntry);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors.join()).toContain('at least one entry');
        }
    });

    it('keeps the client inside the mod directory', () => {
        for (const client of ['../escape.mjs', '/abs.mjs', 'C:/x.mjs', 'sub\\x.mjs', 'client.cjs']) {
            expect(validateManifest({ ...validManifest, client }).ok).toBe(false);
        }
        expect(validateManifest({ ...validManifest, client: 'ui/client.mjs' }).ok).toBe(true);
    });

    it('only accepts known experimental opt-ins', () => {
        expect(validateManifest({ ...validManifest, experimental: ['omni.providers'] }).ok).toBe(true);
        expect(validateManifest({ ...validManifest, experimental: ['mixins'] }).ok).toBe(false);
    });

    it('requires bare https origins plus net.embed for embedOrigins', () => {
        const base = { ...validManifest, permissions: ['net.embed'] };
        expect(validateManifest({ ...base, embedOrigins: ['https://www.youtube-nocookie.com'] }).ok).toBe(true);
        expect(validateManifest({ ...base, embedOrigins: ['http://example.com'] }).ok).toBe(false);
        expect(validateManifest({ ...base, embedOrigins: ['https://example.com/path'] }).ok).toBe(false);
        const withoutPermission = validateManifest({ ...validManifest, embedOrigins: ['https://example.com'] });
        expect(withoutPermission.ok).toBe(false);
        if (!withoutPermission.ok) {
            expect(withoutPermission.errors.join()).toContain('net.embed');
        }
    });

    it('validates the host version range syntax', () => {
        expect(validateManifest({ ...validManifest, folia: '>=0.7.0 <0.8.0' }).ok).toBe(true);
        expect(validateManifest({ ...validManifest, folia: '~0.7' }).ok).toBe(false);
    });
});

describe('satisfiesHostRange', () => {
    it('requires every comparator to hold', () => {
        expect(satisfiesHostRange('0.7.8', '>=0.7.0 <0.8.0')).toBe(true);
        expect(satisfiesHostRange('0.8.0', '>=0.7.0 <0.8.0')).toBe(false);
        expect(satisfiesHostRange('0.6.9', '>=0.7.0 <0.8.0')).toBe(false);
    });

    it('supports caret, exact and wildcard forms', () => {
        expect(satisfiesHostRange('0.7.8', '^0.7.0')).toBe(true);
        expect(satisfiesHostRange('1.0.0', '^0.7.0')).toBe(false);
        expect(satisfiesHostRange('0.7.8', '0.7.8')).toBe(true);
        expect(satisfiesHostRange('0.7.9', '=0.7.8')).toBe(false);
        expect(satisfiesHostRange('9.9.9', '*')).toBe(true);
    });

    it('fails closed on an unknown host version or a bad range', () => {
        expect(satisfiesHostRange(null, '>=0.7.0')).toBe(false);
        expect(satisfiesHostRange('0.7.8', 'latest')).toBe(false);
    });
});

describe('resolveLoadOrder', () => {
    const manifestFor = (id: string, depends: string[] = []) => ({
        id,
        name: id,
        version: '1.0.0',
        folium: 1,
        main: 'index.cjs',
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
        folium: 1,
        main: 'index.cjs',
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

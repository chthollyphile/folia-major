import { describe, expect, it } from 'vitest';
import { assertLibrarySuiteChromeActions, libraryChromeCommandId } from '@/library/core/suite/suiteChrome';
import { buildLibrarySuiteIndex, LIBRARY_ACCOUNT_ACTION_IDS } from '@/library/core/suite/librarySuites';
import type { LibrarySuiteManifest } from '@/library/core/suite/suite.contract';
import type { LibrarySuiteChromeActionMeta } from '@/library/core/suite/suiteChrome.contract';

// test/unit/library/core/suiteChrome.test.ts
// suite 外观动作（B2）的纯规则：命令 id 的拼法与 manifest 声明的自检（建索引时抛错）。用假清单，不经过 glob。

const component = (name: string) => Object.assign(() => name, { displayName: name });

const action = (id: string, overrides: Partial<LibrarySuiteChromeActionMeta> = {}): LibrarySuiteChromeActionMeta => ({
    id,
    title: `Fixture ${id}`,
    description: `Fixture action ${id}`,
    keywords: ['fixture'],
    ...overrides,
});

const gridLike = (): LibrarySuiteManifest => ({
    id: 'grid',
    labelKey: 'grid',
    surfaces: {
        home: { component: component('grid-home'), actions: [] },
        collection: { component: component('grid-collection'), actions: ['play'] },
        artist: { component: component('grid-artist'), actions: ['play'] },
        account: { component: component('grid-account'), actions: [...LIBRARY_ACCOUNT_ACTION_IDS] },
    },
});

const wallLike = (chromeActions: readonly LibrarySuiteChromeActionMeta[], available?: boolean): LibrarySuiteManifest => ({
    id: 'wall',
    labelKey: 'wall',
    ...(available === undefined ? {} : { available }),
    surfaces: {},
    chromeActions,
});

describe('library suite chrome rules', () => {
    it('spells the command id as <suiteId>-<actionId>', () => {
        expect(libraryChromeCommandId('bravais', 'seam-spine')).toBe('bravais-seam-spine');
    });

    it('accepts kebab-case, unique, titled actions', () => {
        expect(() => assertLibrarySuiteChromeActions('wall', [action('seam-spine'), action('locate-playing', { executeShortcut: 'c' })])).not.toThrow();
        expect(() => assertLibrarySuiteChromeActions('wall', undefined)).not.toThrow();
    });

    it('rejects ids that would not survive as a command id or i18n key', () => {
        for (const id of ['Seam', 'seam.spine', 'seam spine', '-seam', 'seam-', '']) {
            expect(() => assertLibrarySuiteChromeActions('wall', [action(id)])).toThrow(/kebab-case/);
        }
    });

    it('rejects a duplicate id, a missing fallback text and a blank execute shortcut', () => {
        expect(() => assertLibrarySuiteChromeActions('wall', [action('seam'), action('seam')])).toThrow(/twice/);
        expect(() => assertLibrarySuiteChromeActions('wall', [action('seam', { title: ' ' })])).toThrow(/fallback title/);
        expect(() => assertLibrarySuiteChromeActions('wall', [action('seam', { description: '' })])).toThrow(/fallback title/);
        expect(() => assertLibrarySuiteChromeActions('wall', [action('seam', { executeShortcut: ' ' })])).toThrow(/empty executeShortcut/);
    });

    it('checks the declarations when the suite index is built, even for a suite this build drops', () => {
        expect(() => buildLibrarySuiteIndex([gridLike(), wallLike([action('seam'), action('seam')])])).toThrow(/twice/);
        expect(() => buildLibrarySuiteIndex([gridLike(), wallLike([action('Seam')], false)])).toThrow(/kebab-case/);
        const index = buildLibrarySuiteIndex([gridLike(), wallLike([action('seam')])]);
        expect(index.get('wall')?.chromeActions?.map(entry => entry.id)).toEqual(['seam']);
    });
});

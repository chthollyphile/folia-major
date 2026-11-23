import { describe, expect, it } from 'vitest';
import { isEmptyModsQuery, parseModsQuery, toggleModsQueryToken } from '@/mods/market/modsQuery';
import { buildModViewItems, compareModVersions, searchModViewItems, sectionModViewItems } from '@/mods/market/marketModel';
import { COMPOUND_ISSUES_URL, FOLIA_ISSUES_URL, issuesUrlOf, modFeedbackOf } from '@/mods/market/modFeedback';
import { parseReadme, parseReadmeInline } from '@/mods/market/readmeMarkdown';
import type { ModAwesomeEntry, ModMarketCatalog, ModMarketEntry, ModRuntimeInfo } from '@/mods/types';

// test/unit/mod-system/modMarketView.test.ts
// The window's half of the mods view (src/mods/market/): the search box's filters, the list that merges the
// installed mods with the catalog, where a mod's problems go, and the README reader, which must never
// produce HTML, links other than https, or images from outside the market site.

const installedMod = (more: Partial<ModRuntimeInfo> = {}): ModRuntimeInfo => ({
    id: 'nice-mod',
    name: 'Nice mod',
    version: '1.0.0',
    author: 'someone',
    description: 'Does nice things',
    permissions: [],
    status: 'loaded',
    error: null,
    enabled: true,
    trustStale: false,
    signature: { status: 'unsigned' } as ModRuntimeInfo['signature'],
    devSource: false,
    experimental: [],
    embedOrigins: [],
    folia: '>=0.7.0',
    hasMain: false,
    clientUrl: null,
    tier: 'user',
    ...more,
});

const marketMod = (more: Partial<ModMarketEntry> = {}): ModMarketEntry => ({
    id: 'nice-mod',
    name: 'Nice mod',
    version: '1.1.0',
    author: 'someone',
    description: 'Does nice things',
    origin: 'community',
    channel: 'release',
    kind: 'standard',
    category: 'lyrics',
    tags: ['network'],
    permissions: [],
    experimental: [],
    embedOrigins: [],
    depends: [],
    folia: '>=0.7.0',
    hasMain: false,
    owners: [{ login: 'someone', url: null }],
    source: null,
    repository: null,
    bugs: null,
    readmeUrl: null,
    keyLabel: null,
    keyId: null,
    signedAt: null,
    addedAt: null,
    updatedAt: '2026-11-01',
    digest: `sha256:${'a'.repeat(64)}`,
    download: { url: 'https://market.example/downloads/x.zip', sha256: 'b'.repeat(64), size: 1 },
    preview: null,
    page: 'https://market.example/#mod-nice-mod',
    hostRange: 'ok',
    communityBlocked: false,
    ...more,
} as ModMarketEntry);

const awesomeEntry = (more: Partial<ModAwesomeEntry> = {}): ModAwesomeEntry => ({
    id: 'outside',
    name: 'Outside source',
    kind: 'source',
    category: null,
    description: 'A source kept elsewhere',
    url: 'https://github.com/me/outside',
    homepage: null,
    bugs: null,
    owners: [{ login: 'me', url: null }],
    tags: [],
    addedAt: null,
    updatedAt: '2026-10-01',
    ...more,
} as ModAwesomeEntry);

const catalogOf = (mods: ModMarketEntry[], awesome: ModAwesomeEntry[] = []): ModMarketCatalog => ({
    version: 3,
    commit: null,
    origin: 'https://market.example',
    categories: [
        { id: 'lyrics', label: { 'zh-CN': '歌词显示', en: 'Lyrics' } },
        { id: 'visualizer', label: { 'zh-CN': '歌词动画', en: 'Visualizers' } },
    ],
    mods,
    awesome,
} as ModMarketCatalog);

describe('the search box', () => {
    it('splits filters, a category and words', () => {
        expect(parseModsQuery('  @Installed lyric @category:Lyrics @nope @installed  Desk ')).toEqual({
            filters: ['installed'],
            category: 'lyrics',
            words: ['lyric', '@nope', 'desk'],
        });
        expect(isEmptyModsQuery(parseModsQuery('   '))).toBe(true);
        expect(isEmptyModsQuery(parseModsQuery('@beta'))).toBe(false);
    });

    it('puts a filter in, takes it out again, and keeps one category', () => {
        expect(toggleModsQueryToken('lyric', '@updates')).toBe('@updates lyric');
        expect(toggleModsQueryToken('@updates lyric', '@updates')).toBe('lyric');
        expect(toggleModsQueryToken('@category:lyrics word', '@category:visualizer')).toBe('@category:visualizer word');
    });
});

describe('the merged list', () => {
    it('orders versions by number', () => {
        expect(compareModVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
        expect(compareModVersions('1.0.0', '1.0.0')).toBe(0);
        expect(compareModVersions('nope', '0.0.1')).toBeLessThan(0);
    });

    it('offers an update only to a user mod, and not one this Folia is too old for', () => {
        const catalog = catalogOf([
            marketMod(),
            marketMod({ id: 'old-host', hostRange: 'too-old' }),
            marketMod({ id: 'builtin-mod' }),
            marketMod({ id: 'same', version: '1.0.0' }),
        ]);
        const items = buildModViewItems([
            installedMod(),
            installedMod({ id: 'old-host' }),
            installedMod({ id: 'builtin-mod', tier: 'builtin' }),
            installedMod({ id: 'same' }),
        ], catalog);
        const update = Object.fromEntries(items.map((item) => [item.id, item.hasUpdate]));
        expect(update).toEqual({ 'nice-mod': true, 'old-host': false, 'builtin-mod': false, same: false });
    });

    it('lists each id once, then the market, then awesome entries', () => {
        const items = buildModViewItems(
            [installedMod()],
            catalogOf([marketMod(), marketMod({ id: 'other-mod', name: 'Other' })], [awesomeEntry({ id: 'nice-mod' })]),
        );
        expect(items.map((item) => item.key)).toEqual(['mod:nice-mod', 'mod:other-mod', 'awesome:nice-mod']);
        expect(items[0]).toMatchObject({ installed: expect.anything(), market: expect.anything(), version: '1.0.0', category: 'lyrics' });
    });

    it('sections the list: updates, held back, installed, the market by category, awesome', () => {
        const items = buildModViewItems(
            [installedMod(), installedMod({ id: 'old-mod', name: 'Old', error: 'host-range-expired', status: 'error' })],
            catalogOf([
                marketMod(),
                marketMod({ id: 'show', name: 'Show', category: 'visualizer' }),
                marketMod({ id: 'stray', name: 'Stray', category: 'unknown-category' }),
            ], [awesomeEntry()]),
        );
        const sections = sectionModViewItems(items, catalogOf([]).categories, 'name');
        expect(sections.map((section) => [section.id, section.items.map((item) => item.id)])).toEqual([
            ['updates', ['nice-mod']],
            ['expired', ['old-mod']],
            ['installed', ['nice-mod', 'old-mod']],
            ['category:visualizer', ['show']],
            ['category:other', ['stray']],
            ['awesome', ['outside']],
        ]);
    });

    it('searches with filters and words, installed ones first', () => {
        const items = buildModViewItems(
            [installedMod({ id: 'desk', name: 'Desk lyrics', enabled: false })],
            catalogOf([marketMod({ id: 'lyric-wall', name: 'Lyric wall' }), marketMod({ id: 'beta-mod', name: 'Beta', channel: 'beta', category: 'visualizer' })], [awesomeEntry()]),
            (id) => (id === 'lyrics' ? '歌词显示' : id),
        );
        const ids = (query: string) => searchModViewItems(items, parseModsQuery(query), 'name').map((item) => item.key);
        expect(ids('lyric')).toEqual(['mod:desk', 'mod:lyric-wall']);
        expect(ids('@disabled')).toEqual(['mod:desk']);
        expect(ids('@beta')).toEqual(['mod:beta-mod']);
        expect(ids('@awesome')).toEqual(['awesome:outside']);
        expect(ids('@source')).toEqual(['awesome:outside']);
        expect(ids('歌词')).toEqual(['mod:lyric-wall']);
        expect(ids('@category:lyrics wall')).toEqual(['mod:lyric-wall']);
    });
});

describe('where problems go', () => {
    it('knows the trackers of the common forges', () => {
        expect(issuesUrlOf('https://github.com/me/mod.git')).toBe('https://github.com/me/mod/issues');
        expect(issuesUrlOf('https://gitlab.com/me/mod')).toBe('https://gitlab.com/me/mod/-/issues');
        expect(issuesUrlOf('https://example.com/me/mod')).toBeNull();
        expect(issuesUrlOf('http://github.com/me/mod')).toBeNull();
    });

    it('asks the manifest first, then the catalog, then the official tracker', () => {
        const own = installedMod({ bugs: 'https://bugs.example/mine', repository: 'https://github.com/me/mod' });
        expect(modFeedbackOf({ installed: own, market: marketMod({ bugs: 'https://other.example' }) }))
            .toEqual({ url: 'https://bugs.example/mine', repository: 'https://github.com/me/mod', owner: 'author' });
        expect(modFeedbackOf({ installed: installedMod({ repository: 'https://github.com/me/mod' }) }).url)
            .toBe('https://github.com/me/mod/issues');
        expect(modFeedbackOf({ installed: installedMod(), market: marketMod({ repository: 'https://codeberg.org/me/mod' }) }))
            .toEqual({ url: 'https://codeberg.org/me/mod/issues', repository: 'https://codeberg.org/me/mod', owner: 'author' });
        expect(modFeedbackOf({ market: marketMod({ origin: 'official' }) })).toMatchObject({ url: COMPOUND_ISSUES_URL, owner: 'compound' });
        expect(modFeedbackOf({ installed: installedMod() })).toEqual({ url: null, repository: null, owner: null });
    });

    it('sends a built-in mod to Folia, and an awesome entry to its own repository', () => {
        expect(modFeedbackOf({ installed: installedMod({ tier: 'builtin' }) })).toMatchObject({ url: FOLIA_ISSUES_URL, owner: 'folia' });
        expect(modFeedbackOf({ awesome: awesomeEntry() })).toEqual({
            url: 'https://github.com/me/outside/issues', repository: 'https://github.com/me/outside', owner: 'author',
        });
    });

    it('ignores links that are not https', () => {
        expect(modFeedbackOf({ installed: installedMod({ bugs: 'javascript:alert(1)', repository: 'http://github.com/me/mod' }) }).url).toBeNull();
    });
});

describe('the README reader', () => {
    const options = { base: 'https://market.example/readmes/nice-mod-1.0.0.md', imageOrigin: 'https://market.example' };

    it('reads the blocks it knows', () => {
        const blocks = parseReadme([
            '# Title', '', 'Some **bold** and *em* and `code`.', '', '- one', '- two', '  more', '', '1. first', '',
            '> quoted', '', '```js', '<b>not html</b>', '```', '', '---',
        ].join('\n'), options);
        expect(blocks.map((block) => block.type)).toEqual(['heading', 'paragraph', 'list', 'list', 'quote', 'code', 'rule']);
        expect(blocks[1]).toEqual({
            type: 'paragraph',
            children: [
                { type: 'text', text: 'Some ' }, { type: 'strong', children: [{ type: 'text', text: 'bold' }] },
                { type: 'text', text: ' and ' }, { type: 'em', children: [{ type: 'text', text: 'em' }] },
                { type: 'text', text: ' and ' }, { type: 'code', text: 'code' }, { type: 'text', text: '.' },
            ],
        });
        expect(blocks[2]).toMatchObject({ ordered: false, items: [[{ type: 'text', text: 'one' }], [{ type: 'text', text: 'two more' }]] });
        expect(blocks[5]).toEqual({ type: 'code', text: '<b>not html</b>' });
    });

    it('keeps raw HTML as text', () => {
        expect(parseReadme('<img src=x onerror=alert(1)> <script>alert(1)</script>', options)).toEqual([
            { type: 'paragraph', children: [{ type: 'text', text: '<img src=x onerror=alert(1)> <script>alert(1)</script>' }] },
        ]);
    });

    it('keeps https links only, resolving relative ones against the README', () => {
        expect(parseReadmeInline('[ok](https://example.com/a)', options)).toEqual([
            { type: 'link', href: 'https://example.com/a', children: [{ type: 'text', text: 'ok' }] },
        ]);
        expect(parseReadmeInline('[rel](other.md)', options)).toEqual([
            { type: 'link', href: 'https://market.example/readmes/other.md', children: [{ type: 'text', text: 'rel' }] },
        ]);
        for (const bad of ['javascript:alert`1`', 'http://example.com', 'data:text/html,x', 'file:///c:/x']) {
            expect(parseReadmeInline(`[bad](${bad})`, options)).toEqual([{ type: 'text', text: 'bad' }]);
        }
        expect(parseReadmeInline('<https://example.com/x>', options)).toEqual([
            { type: 'link', href: 'https://example.com/x', children: [{ type: 'text', text: 'https://example.com/x' }] },
        ]);
    });

    it('loads images from the market site only', () => {
        expect(parseReadmeInline('![shot](https://market.example/previews/a.webp)', options)).toEqual([
            { type: 'image', src: 'https://market.example/previews/a.webp', alt: 'shot' },
        ]);
        expect(parseReadmeInline('![shot](https://tracker.example/pixel.png)', options)).toEqual([
            { type: 'link', href: 'https://tracker.example/pixel.png', children: [{ type: 'text', text: 'shot' }] },
        ]);
        expect(parseReadmeInline('![shot](https://market.example.evil/a.png)', options)[0].type).toBe('link');
        expect(parseReadmeInline('![shot](http://market.example/a.png)', options)).toEqual([{ type: 'text', text: 'shot' }]);
        // Without a market site, no image is loaded at all.
        expect(parseReadmeInline('![shot](https://market.example/a.png)', { base: null, imageOrigin: null })[0].type).toBe('link');
    });

    it('leaves snake_case words alone', () => {
        expect(parseReadmeInline('use some_long_name here', options)).toEqual([{ type: 'text', text: 'use some_long_name here' }]);
    });
});

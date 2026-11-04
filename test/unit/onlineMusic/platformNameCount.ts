import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PLATFORM_NAME_PLACES, PLACE_KINDS, type PlaceKind } from './platformNamePlaces.ts';

// test/unit/onlineMusic/platformNameCount.ts
// Counts the places outside a platform's own folders that name the platform. A place is a line.
// One platform's rule stays with the platform: the count per file is pinned in
// platformNamePlaces.ts and checked by omniArchitecture.test.ts, so it can only go down.
// Run it from the repository root:
//   node test/unit/onlineMusic/platformNameCount.ts            the table by kind
//   node test/unit/onlineMusic/platformNameCount.ts --files    the table and every file
//   node test/unit/onlineMusic/platformNameCount.ts --lower    lowers the numbers in the list
//
// It counts lines, and a count is all the test compares. So a platform's rule can still enter
// shared code without the test failing, in six ways:
//   1. a line that names the platform is taken out of a listed file and another put in: the
//      number is the same;
//   2. the name is added to a line that already names that platform: a line counts once;
//   3. the name is built from parts, or split over lines;
//   4. the rule uses a spelling PLATFORM_NAMES does not have: `xeapi` (NetEase's key), or a
//      host such as 163.com;
//   5. the file lies in a folder that is not read (ROOTS: not mods/, deploy/, dev/), or has an
//      ending that is not read (SOURCE_FILE: not .json, .svg, .mts);
//   6. a new folder anywhere is named exactly like a platform's id: its files count as the
//      platform's own.

const LIST_FILE = 'test/unit/onlineMusic/platformNamePlaces.ts';

export const PLATFORM_NAMES = {
    netease: /netease|网易/i,
    qq: /qq/i,
    kugou: /kugou|酷狗/i,
    bodian: /bodian|波点/i,
    ytm: /ytm|youtube/i,
    spotify: /spotify/i,
    qishui: /qishui|汽水音乐/i,
    fnmusic: /fnmusic|飞牛/i,
} as const;

export type CountedPlatform = keyof typeof PLATFORM_NAMES;
export const COUNTED_PLATFORMS = Object.keys(PLATFORM_NAMES) as CountedPlatform[];

// Folders whose code runs the app. Tests and dev probes hold fixtures and are not counted.
const ROOTS = ['src', 'electron', 'api', 'api-ts', 'worker'];
const SOURCE_FILE = /\.(ts|tsx|cjs|mjs|js|css|md)$/;
// The language files are where a platform's texts are written, and a document describes the
// platforms: both are free to name one, and are counted apart.
const LANGUAGE_FILE = /^src\/i18n\/locales\//;
const DOCUMENT = /\.md$/;
// Never read: it holds no platform rule of ours and must not be opened.
const SKIPPED_FILE = /^electron\/ytm\/poToken\.cjs$/;
// Letters of other things that happen to spell a platform's name.
const NOT_A_NAME = /MmLlHhVvCcSsQqTtAaZz|'quanqiu', 'qq'/g;
const COMMENT_LINE = /^\s*(\/\/|\/?\*|\{\/\*)/;

export interface FileCount {
    // Lines of code that name the platform.
    code: number;
    // Comment lines that name it.
    note: number;
}

export type PlatformCounts = Partial<Record<CountedPlatform, FileCount>>;

const listFiles = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : listFiles(path);
    return SOURCE_FILE.test(entry.name) && !SKIPPED_FILE.test(path) ? [path] : [];
});

// A folder named for a platform is that platform's own: src/services/onlineMusic/qq/, electron/qq/.
const isOwnFile = (file: string, platform: CountedPlatform): boolean => file.split('/').slice(0, -1).includes(platform);

type Counted = Map<string, PlatformCounts>;

/** Every counted file that names a platform outside its own folders, with the count per platform. */
export const countPlatformNames = (): { places: Counted; language: Counted; documents: Counted } => {
    const places: Counted = new Map();
    const language: Counted = new Map();
    const documents: Counted = new Map();
    for (const file of ROOTS.flatMap(listFiles)) {
        const counts: PlatformCounts = {};
        for (const line of readFileSync(file, 'utf8').split('\n')) {
            const text = line.replace(NOT_A_NAME, '');
            for (const platform of COUNTED_PLATFORMS) {
                if (isOwnFile(file, platform) || !PLATFORM_NAMES[platform].test(text)) continue;
                const count = counts[platform] ??= { code: 0, note: 0 };
                if (COMMENT_LINE.test(line)) count.note += 1;
                else count.code += 1;
            }
        }
        if (Object.keys(counts).length === 0) continue;
        if (LANGUAGE_FILE.test(file)) language.set(file, counts);
        else if (DOCUMENT.test(file)) documents.set(file, counts);
        else places.set(file, counts);
    }
    return { places, language, documents };
};

export const totalOf = (count: FileCount | undefined): number => (count ? count.code + count.note : 0);

// The table: per platform, the code places by the kind of their file, the comment places, and
// apart from them the language files and the documents.
const printTable = (showFiles: boolean): void => {
    const { places, language, documents } = countPlatformNames();
    const kinds = [...Object.keys(PLACE_KINDS), 'unlisted'] as Array<PlaceKind | 'unlisted'>;
    const rows = kinds.map(kind => ({ kind, code: Object.fromEntries(COUNTED_PLATFORMS.map(platform => [platform, 0])) }));
    const notes = Object.fromEntries(COUNTED_PLATFORMS.map(platform => [platform, 0]));
    for (const [file, counts] of places) {
        const kind = PLATFORM_NAME_PLACES[file]?.kind ?? 'unlisted';
        for (const platform of COUNTED_PLATFORMS) {
            rows.find(row => row.kind === kind)!.code[platform] += counts[platform]?.code ?? 0;
            notes[platform] += counts[platform]?.note ?? 0;
        }
    }
    const cells = (values: Record<string, number>) => COUNTED_PLATFORMS.map(platform => String(values[platform]).padStart(8)).join('');
    const sum = (of: (platform: CountedPlatform) => number) => Object.fromEntries(COUNTED_PLATFORMS.map(platform => [platform, of(platform)]));
    console.log(`${'kind'.padEnd(10)}${COUNTED_PLATFORMS.map(platform => platform.padStart(8)).join('')}`);
    for (const row of rows) console.log(`${row.kind.padEnd(10)}${cells(row.code)}`);
    console.log(`${'comment'.padEnd(10)}${cells(notes)}`);
    console.log(`${'TOTAL'.padEnd(10)}${cells(sum(platform => rows.reduce((total, row) => total + row.code[platform], notes[platform])))}`);
    console.log(`${'files'.padEnd(10)}${cells(sum(platform => [...places.values()].filter(counts => counts[platform]).length))}`);
    for (const [name, counted] of [['language', language], ['documents', documents]] as const) {
        console.log(`${name.padEnd(10)}${cells(sum(platform => [...counted.values()].reduce((total, counts) => total + totalOf(counts[platform]), 0)))}   (not pinned)`);
    }
    if (!showFiles) return;
    // The list as platformNamePlaces.ts holds it, with today's numbers; a file with comments only says so.
    for (const [file, counts] of [...places].sort(([a], [b]) => (a < b ? -1 : 1))) {
        const named = COUNTED_PLATFORMS.filter(platform => counts[platform]);
        const numbers = named.map(platform => `${platform}: ${totalOf(counts[platform])}`).join(', ');
        const listed = PLATFORM_NAME_PLACES[file];
        const why = listed?.why ? `, why: '${listed.why.replace(/'/g, "\\'")}'` : '';
        const commentsOnly = named.every(platform => counts[platform]!.code === 0) ? '   // comments only' : '';
        console.log(`    '${file}': { n: { ${numbers} }, kind: '${listed?.kind ?? '?'}'${why} },${commentsOnly}`);
    }
};

// Rewrites the numbers in the list to today's counts where they went down, and drops a file that
// names no platform any more. It never raises a number and never adds a file: those it prints.
const lowerList = (): void => {
    const { places } = countPlatformNames();
    const gained: string[] = [...places.keys()].filter(file => !PLATFORM_NAME_PLACES[file]).map(file => `${file}: not in the list`);
    const lines = readFileSync(LIST_FILE, 'utf8').split('\n').flatMap(line => {
        const entry = /^ {4}'([^']+)': \{ n: \{ [^}]* \}(.*)$/.exec(line);
        if (!entry) return [line];
        const [, file, rest] = entry;
        const listed = PLATFORM_NAME_PLACES[file].n;
        const numbers = COUNTED_PLATFORMS.flatMap(platform => {
            const counted = totalOf(places.get(file)?.[platform]);
            if (counted > (listed[platform] ?? 0)) gained.push(`${file}: ${platform} ${listed[platform] ?? 0} -> ${counted}`);
            const kept = Math.min(counted, listed[platform] ?? 0);
            return kept > 0 ? [`${platform}: ${kept}`] : [];
        });
        return numbers.length > 0 ? [`    '${file}': { n: { ${numbers.join(', ')} }${rest}`] : [];
    });
    writeFileSync(LIST_FILE, lines.join('\n'));
    console.log(gained.length > 0 ? `not lowered, these gained places:\n${gained.join('\n')}` : 'the list holds today\'s numbers');
};

if (process.argv[1]?.replace(/\\/g, '/').endsWith('test/unit/onlineMusic/platformNameCount.ts')) {
    if (process.argv.includes('--lower')) lowerList();
    else printTable(process.argv.includes('--files'));
}

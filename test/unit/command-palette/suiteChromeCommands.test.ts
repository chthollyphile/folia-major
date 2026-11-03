import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    COMMAND_PALETTE_COMMANDS,
    isCommandPaletteCommandEnabled,
    setSuiteChromeCommands,
} from '../../../src/components/command-palette/commandRegistry';
import { buildSuiteChromeCommands, type SuiteChromeDeclaration } from '../../../src/components/command-palette/commands/suiteChromeCommands';
import { assertExecuteShortcutsArePrefixFree, buildExecuteShortcutIndex, resolveExecuteShortcut } from '../../../src/components/command-palette/executeShortcuts';
import type { CommandPaletteCommand, CommandPaletteContext } from '../../../src/components/command-palette/types';
import type { AppView } from '../../../src/stores/useAppViewStore';
import type { LibrarySuiteChromeHandle } from '../../../src/library/core/suite/suiteChrome.contract';
import { installLibrarySuiteChromeCommands } from '../../../src/library/app/installLibrarySuiteChromeCommands';
import en from '../../../src/i18n/locales/en';
import zhCN from '../../../src/i18n/locales/zh-CN';
import id from '../../../src/i18n/locales/in';
import { findKeywordOffenders, findUntranslatedCommands, withCommandText, type CommandText } from './commandContractChecks';

// test/unit/command-palette/suiteChromeCommands.test.ts
// suite 外观动作的命令（B2）。生产 registry 里还没有 suite 声明 chromeActions，所以这里用测试夹具里的假 suite：
// 命令按 manifest 生成（id 为 `<suiteId>-<动作 id>`）；只在所属 suite 注册着、首页视图、handler 说能做时可用；
// 装进命令列表时检查 id 唯一与执行键无前缀冲突（冲突抛错、列表不变）；契约检查能枚举到这些动作。

const WALL: SuiteChromeDeclaration = {
    id: 'fixture-wall',
    chromeActions: [
        {
            id: 'seam-spine',
            title: 'Fold the seam to a spine',
            description: 'Collapse the info strip to its narrow spine',
            keywords: ['seam spine', 'collapse seam', '书脊'],
        },
        {
            id: 'locate-playing',
            title: 'Locate now playing',
            description: 'Bring the playing song into view',
            keywords: ['locate', 'now playing', '定位正在播放'],
            // 与 Lattice 的「聚焦当前歌曲」、播放页的「封面」同键：作用范围互斥。
            executeShortcut: 'c',
        },
    ],
};
const TILES: SuiteChromeDeclaration = {
    id: 'fixture-tiles',
    chromeActions: [
        { id: 'locate-playing', title: 'Locate', description: 'Locate the playing tile', keywords: ['locate tile'], executeShortcut: 'c' },
    ],
};

const handle = (suiteId: string, available: Record<string, boolean>): LibrarySuiteChromeHandle => ({
    suiteId,
    isAvailable: vi.fn((actionId: string) => available[actionId] ?? false),
    run: vi.fn((actionId: string) => available[actionId] ?? false),
});

// isAvailable / execute 只读 scope（以及 lattice 定位命令读的 shared.currentSong：有歌在放它才在），其余命名空间用不到。
const contextWith = (chrome: LibrarySuiteChromeHandle | null, view: AppView = 'home') => ({
    scope: { view, filter: null, grid: null, directory: null, artist: null, chrome },
    shared: { currentSong: { id: 1 } },
}) as unknown as CommandPaletteContext;

const commandOf = (commands: CommandPaletteCommand[], commandId: string) => commands.find(command => command.id === commandId)!;
const enabledIds = (commands: CommandPaletteCommand[], context: CommandPaletteContext) => commands
    .filter(command => isCommandPaletteCommandEnabled(command, context))
    .map(command => command.id);

afterEach(() => {
    setSuiteChromeCommands([]);
});

describe('suite chrome commands', () => {
    it('turns every declared action into a <suiteId>-<actionId> command in the suite-chrome scope', () => {
        const commands = buildSuiteChromeCommands([WALL, TILES, { id: 'fixture-plain' }]);
        expect(commands.map(command => command.id)).toEqual([
            'fixture-wall-seam-spine',
            'fixture-wall-locate-playing',
            'fixture-tiles-locate-playing',
        ]);
        expect(commands.every(command => command.scope === 'suite-chrome')).toBe(true);
        expect(commands.map(command => command.scopeOwner)).toEqual(['fixture-wall', 'fixture-wall', 'fixture-tiles']);
        expect(commandOf(commands, 'fixture-wall-seam-spine')).toMatchObject({
            title: 'Fold the seam to a spine',
            description: 'Collapse the info strip to its narrow spine',
            keywords: ['seam spine', 'collapse seam', '书脊'],
        });
        expect(commandOf(commands, 'fixture-wall-seam-spine').executeShortcut).toBeUndefined();
        expect(commandOf(commands, 'fixture-wall-locate-playing').executeShortcut).toBe('c');
    });

    it('is available only while its own suite is registered on home, and its handler says so', () => {
        const commands = buildSuiteChromeCommands([WALL, TILES]);

        expect(enabledIds(commands, contextWith(null))).toEqual([]);
        expect(enabledIds(commands, contextWith(handle('fixture-wall', { 'seam-spine': true })))).toEqual(['fixture-wall-seam-spine']);
        expect(enabledIds(commands, contextWith(handle('fixture-wall', { 'seam-spine': true, 'locate-playing': true }))))
            .toEqual(['fixture-wall-seam-spine', 'fixture-wall-locate-playing']);
        // 另一套 suite 的外观在前台：这套的动作一律不可用，哪怕动作 id 相同。
        expect(enabledIds(commands, contextWith(handle('fixture-tiles', { 'locate-playing': true })))).toEqual(['fixture-tiles-locate-playing']);
        // 外观只在首页视图成立：离开首页时（还没来得及注销）也不提供。
        for (const view of ['player', 'lattice'] as const) {
            expect(enabledIds(commands, contextWith(handle('fixture-wall', { 'seam-spine': true }), view))).toEqual([]);
        }
        // 没有 context（契约测试、固定命令选择器）时不可用，与 grid / artist surface 的命令一致。
        expect(commandOf(commands, 'fixture-wall-seam-spine').isAvailable?.(undefined)).toBe(false);
    });

    it('runs the registered handler of its own suite and nothing else', async () => {
        const [spine] = buildSuiteChromeCommands([WALL]);
        const wall = handle('fixture-wall', { 'seam-spine': true });
        expect(await spine.execute('', contextWith(wall))).toBe(true);
        expect(wall.run).toHaveBeenCalledWith('seam-spine');

        const tiles = handle('fixture-tiles', { 'seam-spine': true });
        expect(await spine.execute('', contextWith(tiles))).toBe(false);
        expect(tiles.run).not.toHaveBeenCalled();
        expect(await spine.execute('', contextWith(null))).toBe(false);
    });

    it('resolves a shared execute key to the chrome command on home and to Lattice on the wall', () => {
        setSuiteChromeCommands(buildSuiteChromeCommands([WALL, TILES]));
        const keyed = COMMAND_PALETTE_COMMANDS.filter(command => (
            command.scope === 'suite-chrome' || command.id === 'lattice-focus-current'
        ));
        const resolveC = (context: CommandPaletteContext) => {
            const resolution = resolveExecuteShortcut(buildExecuteShortcutIndex(keyed.filter(command => isCommandPaletteCommandEnabled(command, context))), 'c');
            return resolution.status === 'exact' ? resolution.command.id : resolution.status;
        };

        const wall = handle('fixture-wall', { 'locate-playing': true });
        expect(resolveC(contextWith(wall))).toBe('fixture-wall-locate-playing');
        expect(resolveC(contextWith(handle('fixture-tiles', { 'locate-playing': true })))).toBe('fixture-tiles-locate-playing');
        expect(resolveC(contextWith(wall, 'lattice'))).toBe('lattice-focus-current');
    });
});

describe('installing suite chrome commands', () => {
    const staticIds = () => COMMAND_PALETTE_COMMANDS.filter(command => command.scope !== 'suite-chrome').map(command => command.id);

    it('appends them to the list and replaces the previous batch instead of duplicating it', () => {
        const before = COMMAND_PALETTE_COMMANDS.map(command => command.id);
        setSuiteChromeCommands(buildSuiteChromeCommands([WALL]));
        setSuiteChromeCommands(buildSuiteChromeCommands([WALL, TILES]));
        expect(COMMAND_PALETTE_COMMANDS.map(command => command.id)).toEqual([
            ...before,
            'fixture-wall-seam-spine',
            'fixture-wall-locate-playing',
            'fixture-tiles-locate-playing',
        ]);
        setSuiteChromeCommands([]);
        expect(COMMAND_PALETTE_COMMANDS.map(command => command.id)).toEqual(before);
    });

    it('lets suites share a key with each other and with the lattice / player commands, but not with anything else', () => {
        // 两套 suite 都用 c，且与 lattice-focus-current（lattice）、panel-cover（player-surface）同键：互斥，允许。
        expect(() => setSuiteChromeCommands(buildSuiteChromeCommands([WALL, TILES]))).not.toThrow();
    });

    it('throws on an execute key clash and leaves the list as it was', () => {
        const before = COMMAND_PALETTE_COMMANDS.map(command => command.id);
        const clash = (executeShortcut: string, suiteId = 'fixture-clash'): SuiteChromeDeclaration => ({
            id: suiteId,
            chromeActions: [{ id: 'act', title: 'Act', description: 'Act now', keywords: ['act'], executeShortcut }],
        });

        // 与全局的「下一首」n 同键 / 互为前缀：首页上同时可用，冲突。
        expect(() => setSuiteChromeCommands(buildSuiteChromeCommands([clash('n')]))).toThrow(/both use execute shortcut "n"/);
        expect(() => setSuiteChromeCommands(buildSuiteChromeCommands([clash('nx')]))).toThrow(/is a prefix of/);
        // 同一套 suite 里的两条外观动作同时可用，同键冲突。
        expect(() => setSuiteChromeCommands(buildSuiteChromeCommands([{
            id: 'fixture-twice',
            chromeActions: [
                { id: 'one', title: 'One', description: 'First', keywords: ['one'], executeShortcut: 'zz' },
                { id: 'two', title: 'Two', description: 'Second', keywords: ['two'], executeShortcut: 'zz' },
            ],
        }]))).toThrow(/both use execute shortcut "zz"/);
        expect(COMMAND_PALETTE_COMMANDS.map(command => command.id)).toEqual(before);

        // 已经装着一批时失败，原来那批也保持不变。
        setSuiteChromeCommands(buildSuiteChromeCommands([WALL]));
        const installed = COMMAND_PALETTE_COMMANDS.map(command => command.id);
        expect(() => setSuiteChromeCommands(buildSuiteChromeCommands([WALL, clash('q')]))).toThrow(/both use execute shortcut "q"/);
        expect(COMMAND_PALETTE_COMMANDS.map(command => command.id)).toEqual(installed);
    });

    it('throws when a generated id collides with an existing command', () => {
        // `artist` + `reload` 拼出来正是歌手页的 artist-reload。
        expect(staticIds()).toContain('artist-reload');
        expect(() => setSuiteChromeCommands(buildSuiteChromeCommands([{
            id: 'artist',
            chromeActions: [{ id: 'reload', title: 'Reload', description: 'Reload it', keywords: ['reload'] }],
        }]))).toThrow(/Duplicate command id "artist-reload"/);
        expect(() => setSuiteChromeCommands([
            ...buildSuiteChromeCommands([WALL]),
            ...buildSuiteChromeCommands([WALL]),
        ])).toThrow(/Duplicate command id "fixture-wall-seam-spine"/);
    });

    it('installs what the real registry declares (B6: five bravais actions, B6b③: three see-through ones), idempotently', () => {
        const before = COMMAND_PALETTE_COMMANDS.map(command => command.id);
        installLibrarySuiteChromeCommands();
        installLibrarySuiteChromeCommands();
        const bravais = ['seam-full', 'seam-spine', 'seam-hide', 'seam-here', 'list', 'directory', 'locate-playing', 'wall-look', 'more-windows', 'fewer-windows'].map(id => `bravais-${id}`);
        expect(COMMAND_PALETTE_COMMANDS.map(command => command.id)).toEqual([...before, ...bravais]);
        setSuiteChromeCommands([]);
        expect(COMMAND_PALETTE_COMMANDS.map(command => command.id)).toEqual(before);
    });
});

describe('command contract over a fixture suite\'s chrome actions', () => {
    const commands = buildSuiteChromeCommands([WALL]);
    const TEXT: Record<string, Record<string, CommandText>> = {
        en: {
            'fixture-wall-seam-spine': { title: 'Seam: spine', description: 'Fold the info strip into a spine' },
            'fixture-wall-locate-playing': { title: 'Locate now playing', description: 'Bring the playing song into view' },
        },
        'zh-CN': {
            'fixture-wall-seam-spine': { title: '缝：书脊', description: '把信息条收成书脊' },
            'fixture-wall-locate-playing': { title: '定位正在播放', description: '把正在播放的歌移进视野' },
        },
        in: {
            'fixture-wall-seam-spine': { title: 'Celah: punggung', description: 'Lipat strip info menjadi punggung' },
            'fixture-wall-locate-playing': { title: 'Temukan yang diputar', description: 'Tampilkan lagu yang sedang diputar' },
        },
    };
    const LOCALES = {
        en: withCommandText(en, TEXT.en),
        'zh-CN': withCommandText(zhCN, TEXT['zh-CN']),
        in: withCommandText(id, TEXT.in),
    };

    it('enumerates the declared actions and finds them translated in all three locales', () => {
        for (const locale of Object.values(LOCALES)) {
            expect(findUntranslatedCommands(commands, locale)).toEqual([]);
        }
    });

    it('reports an action a locale does not translate', () => {
        const { 'fixture-wall-locate-playing': _dropped, ...rest } = TEXT['zh-CN'];
        expect(findUntranslatedCommands(commands, withCommandText(zhCN, rest))).toEqual(['fixture-wall-locate-playing']);
        expect(findUntranslatedCommands(commands, zhCN)).toEqual(['fixture-wall-seam-spine', 'fixture-wall-locate-playing']);
    });

    it('applies the keyword rules to chrome actions too', () => {
        // 夹具的中文不在构建期字典里（插件只扫 src），给一份只含夹具短语的字典。
        const pinyin = { 书脊: { full: 'shuji', initials: 'sj' }, 定位正在播放: { full: 'dingweizhengzaibofang', initials: 'dwzzbf' } };
        expect(findKeywordOffenders(commands, LOCALES, LOCALES['zh-CN'], pinyin)).toEqual([]);

        const sloppy = buildSuiteChromeCommands([{
            id: 'fixture-wall',
            chromeActions: [{ ...WALL.chromeActions![0], keywords: ['seam spine', '书脊', 'shuji', 'Seam: spine'] }],
        }]);
        expect(findKeywordOffenders(sloppy, LOCALES, LOCALES['zh-CN'], pinyin)).toEqual([
            'fixture-wall-seam-spine: "shuji" is generated pinyin',
            'fixture-wall-seam-spine: "Seam: spine" restates a localized title',
        ]);
    });

    it('keeps the fixture keys prefix-free against the shipped static commands', () => {
        const shipped = COMMAND_PALETTE_COMMANDS.filter(command => command.scope !== 'suite-chrome');
        expect(() => assertExecuteShortcutsArePrefixFree([...shipped, ...commands])).not.toThrow();
    });
});

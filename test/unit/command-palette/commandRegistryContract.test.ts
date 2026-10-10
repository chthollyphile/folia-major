import { describe, expect, it } from 'vitest';
import { COMMAND_PALETTE_COMMANDS, getAvailableCommandPaletteCommands, getCommandPaletteMatches } from '../../../src/components/command-palette/commandRegistry';
import { getCommandPrimaryTerm } from '../../../src/components/command-palette/search/commandSearchIndex';
import { PINYIN_BY_PHRASE } from 'virtual:folia-command-pinyin';
import { assertExecuteShortcutsArePrefixFree } from '../../../src/components/command-palette/executeShortcuts';
import en from '../../../src/i18n/locales/en';
import zhCN from '../../../src/i18n/locales/zh-CN';
import id from '../../../src/i18n/locales/in';
import vi from '../../../src/i18n/locales/vi';
import { buildSuiteChromeCommands } from '../../../src/components/command-palette/commands/suiteChromeCommands';
import { listLibrarySuites } from '../../../src/library/registry';
import { findKeywordOffenders, findUntranslatedCommands, listStaticCommands } from './commandContractChecks';

// test/unit/command-palette/commandRegistryContract.test.ts
// Guards the registry invariants a refactor must not silently break: id set, landing-list
// order, and per-command translation coverage across every shipped locale.
// B2: the library suites' chrome actions (manifest `chromeActions`) are commands too, but they are
// installed into the list at app startup rather than declared statically, so the contract enumerates
// them itself from the registry. No shipped suite declares any yet; the same checks run over a fixture
// suite in suiteChromeCommands.test.ts.

const LOCALES = { en, 'zh-CN': zhCN, in: id, vi } as const;

// The chrome commands every available suite declares, built the way the app installs them
// (library/app/installLibrarySuiteChromeCommands), checked alongside the static list.
const SUITE_CHROME_COMMANDS = buildSuiteChromeCommands(listLibrarySuites());
const CONTRACT_COMMANDS = [
    ...COMMAND_PALETTE_COMMANDS.filter(command => command.scope !== 'suite-chrome'),
    ...SUITE_CHROME_COMMANDS,
];

// Static commands resolve their text through commandPalette.commands.<id>. Runtime commands
// (queue songs) carry song metadata and must never be treated as translation keys; hidden
// commands (mode carriers such as execute mode) are never listed, so they need neither.
const staticCommands = listStaticCommands(CONTRACT_COMMANDS);

describe('command palette registry contract', () => {
    it('keeps command ids unique', () => {
        const seen = new Map<string, number>();
        CONTRACT_COMMANDS.forEach(command => {
            seen.set(command.id, (seen.get(command.id) ?? 0) + 1);
        });

        expect([...seen.entries()].filter(([, count]) => count > 1)).toEqual([]);
    });

    it('keeps the registered command order stable', () => {
        expect(COMMAND_PALETTE_COMMANDS.map(command => command.id)).toMatchSnapshot();
    });

    it('enumerates the chrome actions the available suites declare (bravais only: grid and TUI declare none)', () => {
        // B6 起 bravais 进 registry，这里列出它在 manifest 里声明的外观动作（`bravais-<动作 id>`）。
        expect(SUITE_CHROME_COMMANDS.map(command => command.id)).toEqual([
            'bravais-seam-full',
            'bravais-seam-spine',
            'bravais-seam-hide',
            'bravais-seam-here',
            'bravais-list',
            // B9：首页本地的目录树面板（批量模式）。
            'bravais-directory',
            'bravais-locate-playing',
            // B6b③ 透光：循环档位、每块多开 / 少开一个窗。
            'bravais-wall-look',
            'bravais-more-windows',
            'bravais-fewer-windows',
        ]);
        expect(staticCommands).toEqual(expect.arrayContaining(SUITE_CHROME_COMMANDS));
    });

    it.each(Object.keys(LOCALES))('translates every static command in %s', localeName => {
        const locale = LOCALES[localeName as keyof typeof LOCALES];
        const missing = findUntranslatedCommands(CONTRACT_COMMANDS, locale);

        expect(missing).toEqual([]);
    });

    it('keeps coexisting execute shortcuts unique and prefix-free', () => {
        expect(() => assertExecuteShortcutsArePrefixFree(CONTRACT_COMMANDS)).not.toThrow();
    });

    it('withholds execute shortcuts from irreversible commands', () => {
        // Anything here either cannot be undone, spends money or network, or wants a confirmation
        // step; a single keystroke must never be enough to trigger them.
        const guarded = [
            'playback-clear-queue',
            'desktop-toggle-wallpaper-mode',
            'settings-obs-copy-css',
            'sync-now',
            'desktop-toggle-lyric-api',
            'theme-generate-current',
        ];

        const leaked = COMMAND_PALETTE_COMMANDS
            .filter(command => guarded.includes(command.id) && command.executeShortcut)
            .map(command => command.id);

        expect(leaked).toEqual([]);
    });

    // 旧规则是「每条命令必须写有中文关键词和拉丁关键词」，那是在检索完全依赖手写关键词的年代
    // 用形状去逼近意图。现在拼音由构建期生成、本地化标题恒定入索引，形状规则既过时又会阻止清理，
    // 所以换成三条直接检查**结果**的规则。

    it('keeps keywords free of generated pinyin and of title restatements', () => {
        // 迁移从此自我保持：谁再往 keywords 里手写一份能被生成出来的拼音，这条就会红。
        // 规则本体（含「照抄标题只对纯 ASCII 关键词成立」的理由）搬到了 commandContractChecks 的
        // findKeywordOffenders，好让外观动作的夹具跑同一套检查。
        const offenders = findKeywordOffenders(CONTRACT_COMMANDS, LOCALES, zhCN, PINYIN_BY_PHRASE);

        expect(offenders).toEqual([]);
    });

    it('reaches every static command from a Latin-only keyboard', () => {
        // 旧的「必须有拉丁关键词」真正想保证的东西：不会中文输入也能把每条命令搜出来。
        // 直接验结果，而不是验有没有那个字段。
        // 总体用「无 context 时实际可用的命令」，而不是全部静态命令：少数命令的 isAvailable
        // 在没有 context 时刻意返回 false（playback-fm-mode 的 `?? false`），它们压根不进
        // 可用集，搜不到是门控的结果而不是检索的缺陷。
        const reachablePopulation = getAvailableCommandPaletteCommands()
            .filter(command => command.textSource !== 'runtime' && !command.hidden);

        const unreachable = reachablePopulation
            .filter(command => {
                const term = getCommandPrimaryTerm(COMMAND_PALETTE_COMMANDS, command);
                if (!/^[\x20-\x7e]+$/.test(term)) {
                    return true;
                }
                return !getCommandPaletteMatches(term).some(match => match.command.id === command.id);
            })
            .map(command => command.id);

        expect(unreachable).toEqual([]);
    });

    it('gives every static command a non-empty primary term', () => {
        // UI 上那个等宽提示 chip 和「全部命令」的点击回填都读它；空串会渲染出一个空徽章。
        const empty = staticCommands
            .filter(command => !getCommandPrimaryTerm(CONTRACT_COMMANDS, command))
            .map(command => command.id);

        expect(empty).toEqual([]);
    });
});

import { describe, expect, it } from 'vitest';
import { COMMAND_PALETTE_COMMANDS, getAvailableCommandPaletteCommands, getCommandPaletteMatches } from '../../../src/components/command-palette/commandRegistry';
import { getCommandPrimaryTerm } from '../../../src/components/command-palette/search/commandSearchIndex';
import { PINYIN_BY_PHRASE } from 'virtual:folia-command-pinyin';
import { assertExecuteShortcutsArePrefixFree } from '../../../src/components/command-palette/executeShortcuts';
import en from '../../../src/i18n/locales/en';
import zhCN from '../../../src/i18n/locales/zh-CN';
import id from '../../../src/i18n/locales/in';

// test/unit/command-palette/commandRegistryContract.test.ts
// Guards the registry invariants a refactor must not silently break: id set, landing-list
// order, and per-command translation coverage across every shipped locale.

const LOCALES = { en, 'zh-CN': zhCN, in: id } as const;

// Static commands resolve their text through commandPalette.commands.<id>. Runtime commands
// (queue songs) carry song metadata and must never be treated as translation keys; hidden
// commands (mode carriers such as execute mode) are never listed, so they need neither.
const staticCommands = COMMAND_PALETTE_COMMANDS.filter(
    command => command.textSource !== 'runtime' && !command.hidden,
);

const readCommandText = (locale: (typeof LOCALES)[keyof typeof LOCALES], commandId: string) => {
    const commands = (locale as any).commandPalette?.commands as Record<string, { title?: string; description?: string }> | undefined;
    return commands?.[commandId];
};

describe('command palette registry contract', () => {
    it('keeps command ids unique', () => {
        const seen = new Map<string, number>();
        COMMAND_PALETTE_COMMANDS.forEach(command => {
            seen.set(command.id, (seen.get(command.id) ?? 0) + 1);
        });

        expect([...seen.entries()].filter(([, count]) => count > 1)).toEqual([]);
    });

    it('keeps the registered command order stable', () => {
        expect(COMMAND_PALETTE_COMMANDS.map(command => command.id)).toMatchSnapshot();
    });

    it.each(Object.keys(LOCALES))('translates every static command in %s', localeName => {
        const locale = LOCALES[localeName as keyof typeof LOCALES];
        const missing = staticCommands
            .filter(command => {
                const text = readCommandText(locale, command.id);
                return !text?.title || !text?.description;
            })
            .map(command => command.id);

        expect(missing).toEqual([]);
    });

    it('keeps coexisting execute shortcuts unique and prefix-free', () => {
        expect(() => assertExecuteShortcutsArePrefixFree(COMMAND_PALETTE_COMMANDS)).not.toThrow();
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
        const offenders: string[] = [];

        staticCommands.forEach(command => {
            const zh = readCommandText(zhCN, command.id);
            const cjkSources = [
                ...command.keywords.filter(keyword => /[一-鿿]/.test(keyword)),
                zh?.title,
                zh?.description,
            ].filter((value): value is string => Boolean(value));

            const derived = new Set<string>();
            cjkSources.forEach(source => {
                const entry = PINYIN_BY_PHRASE[source];
                if (entry) {
                    derived.add(entry.full);
                    derived.add(entry.initials);
                }
            });

            const localizedText = new Set(
                Object.values(LOCALES)
                    .flatMap(locale => {
                        const text = readCommandText(locale, command.id);
                        return [text?.title, text?.description];
                    })
                    .filter((value): value is string => Boolean(value))
                    .map(value => value.trim().toLowerCase()),
            );

            command.keywords.forEach(keyword => {
                const normalized = keyword.trim().toLowerCase();
                if (derived.has(normalized.replace(/\s+/g, ''))) {
                    offenders.push(`${command.id}: "${keyword}" is generated pinyin`);
                    return;
                }
                // 「照抄标题」只对纯 ASCII 关键词成立。中文关键词即使和 zh 标题逐字相同也不冗余：
                // zh 标题只在中文界面下进语料，而中文关键词在任何界面语言下都是触发词——
                // 删了它，英文界面就再也打不出 `音量条` 这种词。
                const isAsciiKeyword = /^[\x20-\x7e]+$/.test(keyword);
                if (isAsciiKeyword && localizedText.has(normalized)) {
                    offenders.push(`${command.id}: "${keyword}" restates a localized title`);
                }
            });
        });

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
            .filter(command => !getCommandPrimaryTerm(COMMAND_PALETTE_COMMANDS, command))
            .map(command => command.id);

        expect(empty).toEqual([]);
    });
});

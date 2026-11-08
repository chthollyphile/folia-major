import { describe, expect, it } from 'vitest';
import { COMMAND_PALETTE_COMMANDS, getCommandPaletteMatches } from '../../../src/components/command-palette/commandRegistry';
import { findCommandsByTrigger } from '../../../src/components/command-palette/search/commandSearchIndex';

// test/unit/command-palette/subtitleSettingsCommand.test.ts
// 字幕调节面板是一条要输入的 surface 命令：输到它的完整触发词再按空格，面板就直接进它。
// 别的字幕命令的搜索词多以 subtitle / 字幕 开头，这条不能把这些词据为触发词，否则带空格的多词搜索会被它截走。

const triggersSubtitleSettings = (term: string, locale = 'en') => (
    findCommandsByTrigger(COMMAND_PALETTE_COMMANDS, term, locale).some(command => command.id === 'settings-subtitles')
);

describe('settings-subtitles', () => {
    it('不把其他字幕命令共用的开头词当作自己的触发词', () => {
        for (const locale of ['en', 'zh-CN']) {
            for (const term of ['subtitle', 'bottom subtitle', '字幕', 'zimu']) {
                expect(triggersSubtitleSettings(term, locale), `${locale}: ${term}`).toBe(false);
            }
        }
    });

    it('多词搜索仍然落到各自的字幕命令上', () => {
        expect(getCommandPaletteMatches('subtitle background')[0]?.command.id).toBe('settings-toggle-subtitle-background');
        expect(getCommandPaletteMatches('subtitle overlay')[0]?.command.id).toBe('settings-toggle-bottom-subtitle-overlay');
        expect(getCommandPaletteMatches('zimu ceng')[0]?.command.id).toBe('settings-toggle-bottom-subtitle-overlay');
    });

    it('用它自己的说法能找到它', () => {
        expect(getCommandPaletteMatches('subtitle settings')[0]?.command.id).toBe('settings-subtitles');
        expect(getCommandPaletteMatches('字幕调节')[0]?.command.id).toBe('settings-subtitles');
    });
});

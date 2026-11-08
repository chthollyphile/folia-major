import { describe, expect, it } from 'vitest';
import { COMMAND_PALETTE_COMMANDS } from '../../../src/components/command-palette/commandRegistry';
import type { CommandPaletteCommand } from '../../../src/components/command-palette/types';
import { resolveCapsuleQuickActions } from '../../../src/components/floating-player/capsuleQuickActionSelection';

// 胶囊上方浮动命令的挑选：只要声明了 capsuleAction 的、去掉槽位里已有的、此刻能用的，放不下按频次取舍。

const command = (id: string, extra: Partial<CommandPaletteCommand> = {}): CommandPaletteCommand => ({
    id,
    group: 'playback',
    title: id,
    description: id,
    keywords: [],
    execute: () => true,
    capsuleAction: true,
    ...extra,
});

const always = () => true;

describe('resolveCapsuleQuickActions', () => {
    it('注册表里声明了 capsuleAction 的正好是播放交互那几条', () => {
        const ids = COMMAND_PALETTE_COMMANDS.filter(entry => entry.capsuleAction).map(entry => entry.id).sort();
        expect(ids).toEqual([
            'playback-add-to-playlist',
            'playback-like',
            'playback-shuffle',
            'playback-volume',
            'settings-subtitles',
            'visualizer-picker',
        ]);
    });

    it('没声明的、隐藏的、此刻用不了的都不上', () => {
        const result = resolveCapsuleQuickActions({
            commands: [
                command('a'),
                command('settings-thing', { capsuleAction: undefined }),
                command('hidden', { hidden: true }),
                command('busy'),
            ],
            slots: ['loop', 'lyrics-timeline'],
            canInvoke: id => id !== 'busy',
            counts: {},
        });
        expect(result.map(entry => entry.id)).toEqual(['a']);
    });

    it('手指点开的那排不放声明了 mouse-only 的音量，鼠标的照放', () => {
        const input = {
            commands: COMMAND_PALETTE_COMMANDS,
            slots: ['loop', 'lyrics-timeline'] as const,
            canInvoke: always,
            counts: {},
        };
        expect(resolveCapsuleQuickActions(input).map(entry => entry.id)).toContain('playback-volume');
        const touchIds = resolveCapsuleQuickActions({ ...input, touch: true }).map(entry => entry.id);
        expect(touchIds).not.toContain('playback-volume');
        expect(touchIds).toHaveLength(5);
    });

    it('已经在槽位里的不重复', () => {
        const result = resolveCapsuleQuickActions({
            commands: [command('playback-like'), command('playback-volume'), command('visualizer-picker')],
            slots: ['like', 'volume'],
            canInvoke: always,
            counts: {},
        });
        expect(result.map(entry => entry.id)).toEqual(['visualizer-picker']);
    });

    it('默认槽位（循环 + 歌词时间轴）下白名单六条全放得下，歌词样式选择器不会被挤掉', () => {
        const result = resolveCapsuleQuickActions({
            commands: COMMAND_PALETTE_COMMANDS,
            slots: ['loop', 'lyrics-timeline'],
            canInvoke: always,
            counts: {},
        });
        expect(result).toHaveLength(6);
        expect(result.map(entry => entry.id)).toContain('visualizer-picker');
    });

    it('用不了的在截断之前去掉，不占名额', () => {
        const result = resolveCapsuleQuickActions({
            commands: ['a', 'b', 'c', 'd'].map(id => command(id)),
            slots: ['loop', 'lyrics-timeline'],
            canInvoke: id => id !== 'a',
            counts: {},
            limit: 3,
        });
        expect(result.map(entry => entry.id)).toEqual(['b', 'c', 'd']);
    });

    it('放不下时按频次留，留下的仍按注册表顺序排；次数相同取靠前的', () => {
        const commands = ['a', 'b', 'c', 'd'].map(id => command(id));
        const result = resolveCapsuleQuickActions({
            commands,
            slots: ['loop', 'lyrics-timeline'],
            canInvoke: always,
            counts: { d: 9, b: 3 },
            limit: 3,
        });
        expect(result.map(entry => entry.id)).toEqual(['a', 'b', 'd']);
    });
});

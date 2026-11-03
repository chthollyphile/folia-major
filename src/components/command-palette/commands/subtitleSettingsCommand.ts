import { Captions } from 'lucide-react';
import { defineCommand } from '../commandFactories';
import { subtitleSettingsSurface } from '../surfaces/subtitleSettingsSurface';
import type { CommandPaletteCommand } from '../types';

// src/components/command-palette/commands/subtitleSettingsCommand.ts
// One place for the subtitles while a song plays: the bottom subtitle's rows and what each row shows,
// its backdrop, and the 副字幕. Replaces cycling 副字幕内容 as the subtitle button above the player bar:
// that mode no longer drives the bottom subtitle most styles show, so cycling it often changed nothing.

export const subtitleSettingsCommand: CommandPaletteCommand = defineCommand({
    id: 'settings-subtitles',
    group: 'settings',
    title: 'Subtitles',
    description: 'Bottom subtitle rows and what each row shows, its backdrop, and the secondary subtitle',
    // 只放这块面板独有的说法。别的字幕命令（翻译、罗马音、字幕背景、隐藏底部字幕层）的搜索词多以
    // subtitle / 字幕开头：这里若把 subtitle、字幕 本身当关键词，输到「subtitle 」带空格时面板会直接
    // 进这一条，后面的字全成了它的输入，那几条就搜不到了。
    keywords: [
        'subtitle settings', 'subtitle layout', 'subtitle rows', 'captions',
        '字幕设置', '字幕调节', '字幕行数', '三行字幕',
    ],
    icon: Captions,
    capsuleAction: true,
    requiresInput: true,
    surface: subtitleSettingsSurface,
    placeholder: context => context.shared.t('commandPalette.subtitleSettingsPlaceholder', 'Adjust the subtitles below'),
    execute: () => false,
});

import { Boxes } from 'lucide-react';
import type { CommandPaletteCommand } from '../types';
import { defineCommand } from '../commandFactories';
import { modsSurface } from '../surfaces/modsSurface';

// src/components/command-palette/commands/modsCommands.ts
// The mods command is a surface takeover (not a one-shot action): selecting it opens
// the full mod manager inside the palette body, where there is more room than the side
// panel tab.

export const modsCommands: CommandPaletteCommand[] = [
    defineCommand({
        id: 'mods',
        group: 'panel',
        title: 'Mods',
        description: 'Manage mods and export transparent lyric videos',
        keywords: ['mods manager', '模组', '模组管理', 'mokuai', '导出透明视频'],
        icon: Boxes,
        platform: ['electron'],
        // Behind the mod system switch (Settings → Mods): with it off the main
        // process loads no mod at all, so the entry would open a manager over nothing.
        isAvailable: context => context?.settings.modSystemEnabled ?? true,
        requiresInput: true,
        surface: modsSurface,
        execute: () => false,
    }),
];
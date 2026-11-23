import { Boxes, RefreshCw, Store } from 'lucide-react';
import type { CommandPaletteCommand } from '../types';
import { defineCommand } from '../commandFactories';

// Opens the mods window (over Settings → Mods) with this search in its box (the view takes it from the market store).
const openModsView = (context: Parameters<CommandPaletteCommand['execute']>[1], query: string, refresh: boolean) => {
    void import('../../../mods/market/useModMarketStore').then(({ useModMarketStore }) => {
        useModMarketStore.getState().requestQuery(query);
        if (refresh) void useModMarketStore.getState().load({ force: true });
    });
    context.settings.openSettings('options', 'modsWindow');
};

// src/components/command-palette/commands/modsCommands.ts
// All three open the mods window (src/mods/market/ModsWindow.tsx, over Settings → Mods): installed mods and
// the market need more room than the palette body has. The update check comes with `@updates` in the search
// and reads the market again.

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
        settingsTarget: { subview: 'modsWindow' },
        execute: (_input, context) => {
            openModsView(context, '', false);
            return true;
        },
    }),
    defineCommand({
        id: 'mods-market',
        group: 'settings',
        title: 'Open the mod market',
        description: 'Browse, install and update mods',
        keywords: ['mod market', 'extensions', 'install mods', '模组市场', '安装模组', '插件市场'],
        icon: Store,
        platform: ['electron'],
        isAvailable: context => context?.settings.modSystemEnabled ?? true,
        settingsTarget: { subview: 'modsWindow' },
        execute: (_input, context) => {
            openModsView(context, '', false);
            return true;
        },
    }),
    defineCommand({
        id: 'mods-check-updates',
        group: 'settings',
        title: 'Check for mod updates',
        description: 'Read the mod market again and list the mods that have updates',
        keywords: ['mod updates', 'update mods', '模组更新', '检查更新', '更新模组'],
        icon: RefreshCw,
        platform: ['electron'],
        isAvailable: context => context?.settings.modSystemEnabled ?? true,
        execute: (_input, context) => {
            openModsView(context, '@updates', true);
            return true;
        },
    }),
];

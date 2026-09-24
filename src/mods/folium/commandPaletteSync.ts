import { Puzzle } from 'lucide-react';
import i18n from '@/i18n/config';
import { COMMAND_PALETTE_COMMANDS } from '@/components/command-palette/commandRegistry';
import type { CommandPaletteCommand } from '@/components/command-palette/types';
import type { CommandPaletteSurface } from '@/components/command-palette/surfaces/types';
import { resolveFoliumLabel } from './params';
import type { FoliumRegistryEntry } from './registry';
import { commandsRegistry, runFoliumCommand, type StoredFoliumCommand } from './registries/commands';

// src/mods/folium/commandPaletteSync.ts
// Mirrors `folium.registries.commands` into the command palette. Kept out of
// the registry module on purpose: only the main window has a palette, and the
// export window must not pull the palette's module graph in.
//
// A command without params runs straight from the palette; one with params
// opens a form surface (FoliumCommandSurfaceView) and runs from its button.
// Titles are runtime text (no i18n keys exist for mod commands), resolved in
// the UI language at sync time; every label translation also goes into the
// keywords so any language finds the command.

export const FOLIUM_COMMAND_PREFIX = 'folium:';

const synced = new Map<string, CommandPaletteCommand>();

const buildSurface = (entryId: string): CommandPaletteSurface => ({
    load: () => import('./FoliumCommandSurfaceView'),
    mapProps: ({ theme, isDaylight, close }) => ({ commandId: entryId, theme, isDaylight, close }),
});

const buildPaletteCommand = (entry: FoliumRegistryEntry<StoredFoliumCommand>): CommandPaletteCommand => {
    const { def, params } = entry.def;
    const language = i18n.language || 'en';
    const labels = Object.values(def.label ?? {}).filter((value): value is string => Boolean(value));
    return {
        id: `${FOLIUM_COMMAND_PREFIX}${entry.id}`,
        group: 'panel',
        title: resolveFoliumLabel(def.label, language, entry.name),
        description: resolveFoliumLabel(def.description, language, entry.modId),
        textSource: 'runtime',
        icon: Puzzle,
        keywords: [...labels, ...(def.keywords ?? []), entry.name, entry.modId],
        isAvailable: (context) => context?.settings.modSystemEnabled ?? true,
        ...(params.length > 0
            ? { requiresInput: true, surface: buildSurface(entry.id), execute: () => false }
            : { execute: async () => (await runFoliumCommand(entry, {})).ok }),
    };
};

const sync = () => {
    const desired = new Map(commandsRegistry.list().map((entry) => [entry.id, entry] as const));
    Array.from(synced.entries()).forEach(([id, command]) => {
        if (desired.has(id)) return;
        const index = COMMAND_PALETTE_COMMANDS.indexOf(command);
        if (index >= 0) COMMAND_PALETTE_COMMANDS.splice(index, 1);
        synced.delete(id);
    });
    desired.forEach((entry, id) => {
        if (synced.has(id)) return;
        const command = buildPaletteCommand(entry);
        COMMAND_PALETTE_COMMANDS.push(command);
        synced.set(id, command);
    });
};

let installed = false;

/** Starts mirroring mod commands into the palette (main window only; idempotent). */
export const installFoliumCommandPaletteSync = () => {
    if (installed) return;
    installed = true;
    sync();
    commandsRegistry.subscribe(sync);
};

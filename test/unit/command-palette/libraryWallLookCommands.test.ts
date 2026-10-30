import { describe, expect, it, vi } from 'vitest';
import { COMMAND_PALETTE_COMMANDS } from '@/components/command-palette/commandRegistry';
import {
    libraryWallLookPickerSurface,
    libraryWallSeamDirectionPickerSurface,
    libraryWallSeamStylePickerSurface,
    libraryWallWindowsPickerSurface,
    readLibraryWallPick,
} from '@/components/command-palette/surfaces/libraryWallLookSurface';
import type { CommandPaletteContext } from '@/components/command-palette/types';
import type { LibraryWallLook } from '@/utils/libraryWallLook';
import type { LibraryWallSeamStyle } from '@/utils/libraryWallSeamStyle';
import type { LibraryWallSeamDirection } from '@/utils/libraryWallSeamDirection';

// test/unit/command-palette/libraryWallLookCommands.test.ts
// bravais 透光的两条命令（B6b②）：可用性与设置分区同一个谓词（context.settings.isLibraryWallLookAvailable，
// 生效 suite 是 bravais），窗数命令另要求档位是部分透明；两个 picker 的行、当前项标记、筛选与执行。
// 2026-10-09：信息条始终透明 / 墙后画面歌词 / 模糊三个开关，信息条样式 picker（透明开着时不可用，与设置分区禁用同一个条件）。

type Settings = {
    available: boolean;
    look: LibraryWallLook;
    windows: number;
    seamClear?: boolean;
    seamStyle?: LibraryWallSeamStyle;
    seamDirection?: LibraryWallSeamDirection;
};

const createContext = (state: Settings) => {
    const setLibraryWallLook = vi.fn((look: LibraryWallLook) => { state.look = look; });
    const setLibraryWallWindowsPerBlock = vi.fn((count: number) => { state.windows = count; });
    const toggleLibraryWallStackEdges = vi.fn();
    const toggleLibraryWallSeamClear = vi.fn();
    const toggleLibraryWallBackdropLyrics = vi.fn();
    const toggleLibraryWallBackdropBlur = vi.fn();
    const setLibraryWallSeamDirection = vi.fn((direction: LibraryWallSeamDirection) => { state.seamDirection = direction; });
    const setLibraryWallSeamStyle = vi.fn((style: LibraryWallSeamStyle) => { state.seamStyle = style; });
    const openSettings = vi.fn();
    const context = {
        shared: { t: (_key: string, fallback?: string) => fallback ?? '' },
        settings: {
            toggleLibraryWallStackEdges,
            toggleLibraryWallSeamClear,
            toggleLibraryWallBackdropLyrics,
            toggleLibraryWallBackdropBlur,
            libraryWallSeamDirection: () => state.seamDirection ?? 'auto',
            setLibraryWallSeamDirection,
            libraryWallSeamClear: () => state.seamClear ?? false,
            libraryWallSeamStyle: () => state.seamStyle ?? 'paper',
            setLibraryWallSeamStyle,
            openSettings,
            isLibraryWallLookAvailable: () => state.available,
            libraryWallLook: () => state.look,
            setLibraryWallLook,
            libraryWallWindowsPerBlock: () => state.windows,
            setLibraryWallWindowsPerBlock,
        },
    } as unknown as CommandPaletteContext;
    return {
        context,
        setLibraryWallLook,
        setLibraryWallWindowsPerBlock,
        toggleLibraryWallStackEdges,
        toggleLibraryWallSeamClear,
        toggleLibraryWallBackdropLyrics,
        toggleLibraryWallBackdropBlur,
        setLibraryWallSeamDirection,
        setLibraryWallSeamStyle,
        openSettings,
    };
};

const command = (id: string) => {
    const found = COMMAND_PALETTE_COMMANDS.find(candidate => candidate.id === id);
    if (!found) throw new Error(`missing command ${id}`);
    return found;
};

describe('library wall look commands', () => {
    it('are registered in the settings group behind a picker surface, with no execute shortcut', () => {
        for (const id of ['library-wall-look-picker', 'library-wall-windows-picker']) {
            const entry = command(id);
            expect(entry.group).toBe('settings');
            expect(entry.surface).toBeDefined();
            expect(entry.requiresInput).toBe(true);
            expect(entry.executeShortcut).toBeUndefined();
        }
    });

    it('offers the look picker only while bravais is the effective suite', () => {
        const look = command('library-wall-look-picker');
        for (const value of ['solid', 'partial', 'clear'] as const) {
            expect(look.isAvailable?.(createContext({ available: true, look: value, windows: 3 }).context)).toBe(true);
            expect(look.isAvailable?.(createContext({ available: false, look: value, windows: 3 }).context)).toBe(false);
        }
    });

    it('offers the windows picker only on bravais with the partial look', () => {
        const windows = command('library-wall-windows-picker');
        const available = (state: Settings) => windows.isAvailable?.(createContext(state).context);

        expect(available({ available: true, look: 'partial', windows: 3 })).toBe(true);
        expect(available({ available: true, look: 'solid', windows: 3 })).toBe(false);
        expect(available({ available: true, look: 'clear', windows: 3 })).toBe(false);
        expect(available({ available: false, look: 'partial', windows: 3 })).toBe(false);
    });

    it('stays listable without a context (contract checks, the all-commands list)', () => {
        expect(command('library-wall-look-picker').isAvailable?.()).toBe(true);
        expect(command('library-wall-windows-picker').isAvailable?.()).toBe(true);
    });
});

describe('library wall look picker', () => {
    it('lists the three looks in order and marks the current one', () => {
        const { context } = createContext({ available: true, look: 'clear', windows: 3 });
        const matches = libraryWallLookPickerSurface.buildMatches!({ context, query: '' });

        expect(matches.map(match => readLibraryWallPick(match.command.id))).toEqual(['solid', 'partial', 'clear']);
        expect(matches.every(match => match.command.textSource === 'runtime')).toBe(true);
        expect(matches[2].command.description).toBe('In use');
        expect(matches[0].command.description).not.toBe('In use');
    });

    it('filters by label or id and applies the picked look', async () => {
        const { context, setLibraryWallLook } = createContext({ available: true, look: 'partial', windows: 3 });
        const matches = libraryWallLookPickerSurface.buildMatches!({ context, query: 'solid' });

        expect(matches.map(match => readLibraryWallPick(match.command.id))).toEqual(['solid']);
        expect(await matches[0].command.execute('', context)).toBe(true);
        expect(setLibraryWallLook).toHaveBeenCalledWith('solid');
    });
});

describe('library wall windows picker', () => {
    it('lists one to six windows with their share of a block and marks the current count', () => {
        const { context } = createContext({ available: true, look: 'partial', windows: 4 });
        const matches = libraryWallWindowsPickerSurface.buildMatches!({ context, query: '' });

        expect(matches.map(match => readLibraryWallPick(match.command.id))).toEqual(['1', '2', '3', '4', '5', '6']);
        expect(matches[0].command.description).toContain('8%');
        expect(matches[5].command.description).toContain('50%');
        expect(matches[3].command.description.startsWith('In use')).toBe(true);
        expect(matches[2].command.description.startsWith('In use')).toBe(false);
    });

    it('finds a count by its number or its percentage and applies it', async () => {
        const { context, setLibraryWallWindowsPerBlock } = createContext({ available: true, look: 'partial', windows: 3 });

        const byCount = libraryWallWindowsPickerSurface.buildMatches!({ context, query: '5' });
        expect(byCount.map(match => readLibraryWallPick(match.command.id))).toEqual(['5']);

        // 1–6 只认档位本身，不做子串匹配（「5」不会顺带命中 25% / 50%）。
        const byOne = libraryWallWindowsPickerSurface.buildMatches!({ context, query: '1' });
        expect(byOne.map(match => readLibraryWallPick(match.command.id))).toEqual(['1']);

        const byShare = libraryWallWindowsPickerSurface.buildMatches!({ context, query: '33%' });
        expect(byShare.map(match => readLibraryWallPick(match.command.id))).toEqual(['4']);
        const byBareShare = libraryWallWindowsPickerSurface.buildMatches!({ context, query: '50' });
        expect(byBareShare.map(match => readLibraryWallPick(match.command.id))).toEqual(['6']);

        expect(await byShare[0].command.execute('', context)).toBe(true);
        expect(setLibraryWallWindowsPerBlock).toHaveBeenCalledWith(4);
    });

    // 2026-10-09：bravais 独有的设置整理进界面设置的「Bravais 墙面」分组；集合叠页边是一个开关。
    it('toggles the collection stack edges and jumps to the Bravais group only while bravais is the effective suite', () => {
        const toggle = command('library-wall-stack-edges-toggle');
        const anchor = command('settings-bravais');
        for (const entry of [toggle, anchor]) {
            expect(entry.group).toBe('settings');
            expect(entry.executeShortcut).toBeUndefined();
            expect(entry.isAvailable?.(createContext({ available: true, look: 'solid', windows: 3 }).context)).toBe(true);
            expect(entry.isAvailable?.(createContext({ available: false, look: 'solid', windows: 3 }).context)).toBe(false);
        }
        expect(anchor.settingsTarget).toEqual({ subview: 'home', anchorId: 'bravaisSettings' });

        const { context, toggleLibraryWallStackEdges, openSettings } = createContext({ available: true, look: 'solid', windows: 3 });
        expect(toggle.execute('', context)).toBe(true);
        expect(toggleLibraryWallStackEdges).toHaveBeenCalledTimes(1);
        expect(anchor.execute('', context)).toBe(true);
        expect(openSettings).toHaveBeenCalledWith('options', 'home', null, 'bravaisSettings');
    });
});

describe('bravais info strip and backdrop commands', () => {
    it('flip the see-through strip and the backdrop lyrics / blur only while bravais is the effective suite', () => {
        const ids = ['library-wall-seam-clear-toggle', 'library-wall-backdrop-lyrics-toggle', 'library-wall-backdrop-blur-toggle'] as const;
        for (const id of ids) {
            const entry = command(id);
            expect(entry.group).toBe('settings');
            expect(entry.executeShortcut).toBeUndefined();
            expect(entry.isAvailable?.(createContext({ available: true, look: 'solid', windows: 3 }).context)).toBe(true);
            expect(entry.isAvailable?.(createContext({ available: false, look: 'solid', windows: 3 }).context)).toBe(false);
        }
        const created = createContext({ available: true, look: 'solid', windows: 3 });
        expect(command('library-wall-seam-clear-toggle').execute('', created.context)).toBe(true);
        expect(command('library-wall-backdrop-lyrics-toggle').execute('', created.context)).toBe(true);
        expect(command('library-wall-backdrop-blur-toggle').execute('', created.context)).toBe(true);
        expect(created.toggleLibraryWallSeamClear).toHaveBeenCalledTimes(1);
        expect(created.toggleLibraryWallBackdropLyrics).toHaveBeenCalledTimes(1);
        expect(created.toggleLibraryWallBackdropBlur).toHaveBeenCalledTimes(1);
    });

    it('offers the info strip style picker only on bravais while the strip is not see-through', () => {
        const picker = command('library-wall-seam-style-picker');
        expect(picker.surface).toBeDefined();
        expect(picker.requiresInput).toBe(true);
        expect(picker.executeShortcut).toBeUndefined();
        const available = (state: Settings) => picker.isAvailable?.(createContext(state).context);
        expect(available({ available: true, look: 'solid', windows: 3 })).toBe(true);
        expect(available({ available: true, look: 'clear', windows: 3 })).toBe(true);
        expect(available({ available: true, look: 'solid', windows: 3, seamClear: true })).toBe(false);
        expect(available({ available: false, look: 'solid', windows: 3 })).toBe(false);
        expect(picker.isAvailable?.()).toBe(true);
    });

    it('lists the eight styles in order, marks the current one and applies the pick', async () => {
        const { context, setLibraryWallSeamStyle } = createContext({ available: true, look: 'solid', windows: 3, seamStyle: 'dots' });
        const matches = libraryWallSeamStyleSurfaceMatches(context, '');
        expect(matches.map(match => readLibraryWallPick(match.command.id)))
            .toEqual(['paper', 'white', 'black', 'frost', 'dots', 'hatch', 'contour', 'check']);
        expect(matches[4].command.description).toBe('In use');
        expect(matches[1].command.description).toBe('Fixed paper and ink, high contrast');

        const byLabel = libraryWallSeamStyleSurfaceMatches(context, 'ging');
        expect(byLabel.map(match => readLibraryWallPick(match.command.id))).toEqual(['check']);
        expect(await byLabel[0].command.execute('', context)).toBe(true);
        expect(setLibraryWallSeamStyle).toHaveBeenCalledWith('check');
    });
});

describe('bravais info strip direction picker', () => {
    it('is offered while bravais is the effective suite, lists auto / auto-reverse / vertical / horizontal and applies the pick', async () => {
        const picker = command('library-wall-seam-direction-picker');
        expect(picker.surface).toBeDefined();
        expect(picker.executeShortcut).toBeUndefined();
        expect(picker.isAvailable?.(createContext({ available: true, look: 'solid', windows: 3 }).context)).toBe(true);
        expect(picker.isAvailable?.(createContext({ available: false, look: 'solid', windows: 3 }).context)).toBe(false);

        const { context, setLibraryWallSeamDirection } = createContext({ available: true, look: 'solid', windows: 3, seamDirection: 'auto' });
        const matches = libraryWallSeamDirectionPickerSurface.buildMatches!({ context, query: '' });
        expect(matches.map(match => readLibraryWallPick(match.command.id))).toEqual(['auto', 'auto-reverse', 'vertical', 'horizontal']);
        expect(matches[0].command.description).toMatch(/^In use/);
        const byLabel = libraryWallSeamDirectionPickerSurface.buildMatches!({ context, query: 'horiz' });
        expect(byLabel.map(match => readLibraryWallPick(match.command.id))).toEqual(['horizontal']);
        expect(await byLabel[0].command.execute('', context)).toBe(true);
        expect(setLibraryWallSeamDirection).toHaveBeenCalledWith('horizontal');
    });
});

function libraryWallSeamStyleSurfaceMatches(context: CommandPaletteContext, query: string) {
    return libraryWallSeamStylePickerSurface.buildMatches!({ context, query });
}

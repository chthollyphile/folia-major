import { closeHomePage } from '../../mods/folium/homePages';
import type { HomeViewTab, ReplayGainMode, VisualizerMode } from '../../types';
import type { AppLanguagePreference } from '../../i18n/config';
import type { PanelTab } from '../UnifiedPanel';
import type { AudioEqualizerModeId } from '../../utils/audioEqualizer';
import type { GridSurfaceActionId } from '../../types/gridCommandSurface';
import type { LibraryDirectorySurfaceActionId } from '../../library/core/contracts/directory';
import type { LibraryArtistSurfaceActionId } from '../../library/core/contracts/artist';
import type { LibrarySuiteChromeActionMeta } from '../../library/core/contracts/suiteChrome';
import { libraryChromeCommandId } from '../../library/core/model/suiteChrome';
import { settingsAnchorSubview, type SettingsAnchorId } from '../modal/settings/navigation/settingsAnchorModel';
import type { CommandPaletteCommand, CommandPaletteContext, CommandPaletteGroup } from './types';

// src/components/command-palette/commandFactories.ts
// The single construction entry point for palette commands, plus the shaped factories the
// registry uses repeatedly. Everything a command does — text, gating, surface, syntax — is
// declared in one object here rather than scattered across filter functions and the shell.

export const defineCommand = (command: CommandPaletteCommand): CommandPaletteCommand => command;

// Most inline commands were "call one context toggle, report success"; this collapses them.
export const createToggleCommand = (
    id: string,
    group: CommandPaletteGroup,
    title: string,
    description: string,
    keywords: string[],
    run: (context: CommandPaletteContext) => void,
    options: Pick<CommandPaletteCommand, 'platform' | 'isAvailable' | 'icon' | 'openHotkey' | 'executeShortcut'> = {},
): CommandPaletteCommand => defineCommand({
    id,
    group,
    title,
    description,
    keywords,
    ...options,
    execute: (_input, context) => {
        run(context);
        return true;
    },
});

export const createSettingsCommand = (
    id: string,
    title: string,
    description: string,
    keywords: string[],
    initialTab: 'help' | 'options',
    initialSubview: Parameters<CommandPaletteContext['settings']['openSettings']>[1] = null,
    options: Pick<CommandPaletteCommand, 'platform' | 'isAvailable' | 'executeShortcut'> = {},
): CommandPaletteCommand => ({
    id,
    group: 'settings',
    title,
    description,
    keywords,
    ...options,
    ...(initialTab === 'options' && initialSubview ? { settingsTarget: { subview: initialSubview } } : {}),
    execute: (_input, context) => {
        context.settings.openSettings(initialTab, initialSubview);
        return true;
    },
});

/**
 * Opens the settings dialog on the group a section is made of, not just the page it lives on.
 *
 * The section is derived from the anchor rather than passed alongside it: naming both is two
 * chances to disagree, and the one that would be wrong is invisible until someone runs the command.
 */
export const createSettingsAnchorCommand = (
    id: string,
    title: string,
    description: string,
    keywords: string[],
    anchorId: SettingsAnchorId,
    options: Pick<CommandPaletteCommand, 'platform' | 'isAvailable' | 'executeShortcut'> = {},
): CommandPaletteCommand => ({
    id,
    group: 'settings',
    title,
    description,
    keywords,
    ...options,
    settingsTarget: { subview: settingsAnchorSubview(anchorId), anchorId },
    execute: (_input, context) => {
        context.settings.openSettings('options', settingsAnchorSubview(anchorId), null, anchorId);
        return true;
    },
});

/**
 * One action published by the track grid on screen.
 *
 * `isAvailable` asks the grid's own `availableActions` rather than re-deriving the branch: the
 * conditions the buttons render under (a local folder sorts, a resync is already running) live in
 * one place, and a command must never offer what the panel would refuse.
 */
export const createGridSurfaceCommand = (
    id: string,
    title: string,
    description: string,
    keywords: string[],
    action: GridSurfaceActionId,
    icon?: CommandPaletteCommand['icon'],
): CommandPaletteCommand => defineCommand({
    id,
    group: 'grid',
    title,
    description,
    keywords,
    icon,
    scope: 'grid-surface',
    isAvailable: context => context?.scope.grid?.getState().availableActions.includes(action) ?? false,
    execute: (_input, context) => {
        context.scope.grid?.run(action);
        return true;
    },
});

/**
 * One action published by the home directory on screen (GridMap's batch selection and hidden view).
 *
 * Same contract as the grid surface: `isAvailable` asks the directory's own `availableActions`, which
 * come from the same Library Core capabilities the batch panel's buttons obey. A command that needs
 * text (a playlist name) passes the palette input through; `run` refuses an empty one.
 */
export const createDirectorySurfaceCommand = (
    id: string,
    title: string,
    description: string,
    keywords: string[],
    action: LibraryDirectorySurfaceActionId,
    icon?: CommandPaletteCommand['icon'],
    options: Pick<CommandPaletteCommand, 'requiresInput' | 'placeholder'> = {},
): CommandPaletteCommand => defineCommand({
    id,
    group: 'grid',
    title,
    description,
    keywords,
    icon,
    ...options,
    scope: 'directory-surface',
    isAvailable: context => context?.scope.directory?.getState().availableActions.includes(action) ?? false,
    execute: (input, context) => context.scope.directory?.run(action, input) ?? false,
});

/**
 * One action published by the artist page on screen (its top songs, reload, album retry, entity editing).
 *
 * Same contract as the other library surfaces: `isAvailable` asks the page's own `availableActions`,
 * which are the Library Core artist capabilities intersected with what the rendering suite declares.
 */
export const createArtistSurfaceCommand = (
    id: string,
    title: string,
    description: string,
    keywords: string[],
    action: LibraryArtistSurfaceActionId,
    icon?: CommandPaletteCommand['icon'],
): CommandPaletteCommand => defineCommand({
    id,
    group: 'grid',
    title,
    description,
    keywords,
    icon,
    scope: 'artist-surface',
    isAvailable: context => context?.scope.artist?.getState().availableActions.includes(action) ?? false,
    execute: (_input, context) => context.scope.artist?.run(action) ?? false,
});

/**
 * One chrome action a library suite declares in its manifest (`chromeActions`, B2), as a palette command
 * with the id `<suiteId>-<actionId>`.
 *
 * The text, keywords and execute key are static (so the registry contract can enumerate them); whether it
 * applies is asked of whoever registered the suite chrome right now. It is offered only while that is this
 * very suite — another suite's chrome on screen, or none, greys it out — and only while the suite's own
 * handler says it can run. `scopeOwner` lets two suites reuse a key: their chrome is never up together.
 */
export const createSuiteChromeCommand = (
    suiteId: string,
    action: LibrarySuiteChromeActionMeta,
): CommandPaletteCommand => defineCommand({
    id: libraryChromeCommandId(suiteId, action.id),
    group: 'grid',
    title: action.title,
    description: action.description,
    keywords: [...action.keywords],
    scope: 'suite-chrome',
    scopeOwner: suiteId,
    ...(action.executeShortcut ? { executeShortcut: action.executeShortcut } : {}),
    isAvailable: (context) => {
        const chrome = context?.scope.chrome;
        return chrome?.suiteId === suiteId && chrome.isAvailable(action.id);
    },
    execute: (_input, context) => {
        const chrome = context.scope.chrome;
        return chrome?.suiteId === suiteId ? chrome.run(action.id) : false;
    },
});

export const createAppLanguageCommand = (
    id: string,
    preference: AppLanguagePreference,
    title: string,
    description: string,
    keywords: string[],
): CommandPaletteCommand => ({
    id,
    group: 'settings',
    title,
    description,
    keywords,
    execute: async (_input, context) => {
        await context.settings.setAppLanguagePreference(preference);
        return true;
    },
});

export const createReplayGainCommand = (
    mode: ReplayGainMode,
    title: string,
    description: string,
    keywords: string[],
): CommandPaletteCommand => ({
    id: `playback-replaygain-${mode}`,
    group: 'playback',
    title,
    description,
    keywords,
    execute: (_input, context) => {
        context.playback.setReplayGainMode(mode);
        return true;
    },
});

// Applies a built-in sound preset or a saved custom slot (EQ curve plus effect chain) without opening the dialog.
export const createSoundPresetCommand = (
    presetId: AudioEqualizerModeId,
    title: string,
    description: string,
    keywords: string[],
): CommandPaletteCommand => ({
    id: `playback-sound-preset-${presetId}`,
    group: 'playback',
    title,
    description,
    // 拼音由构建期从 '音效预设' 生成，不再手写。
    keywords: [...keywords, 'sound preset', 'audio preset', '音效预设'],
    execute: (_input, context) => {
        context.playback.applyAudioSoundPreset(presetId);
        return true;
    },
});

export const createHomeTabCommand = (
    tab: HomeViewTab,
    title: string,
    description: string,
    keywords: string[]
): CommandPaletteCommand => ({
    id: `home-${tab}`,
    group: 'navigation',
    title,
    description,
    keywords,
    execute: (_input, context) => {
        closeHomePage();
        context.navigation.setHomeViewTab(tab);
        context.navigation.navigateToHome();
        return true;
    },
});

export const createPanelCommand = (
    tab: PanelTab,
    title: string,
    description: string,
    keywords: string[],
    icon?: CommandPaletteCommand['icon'],
    options: Pick<CommandPaletteCommand, 'executeShortcut'> = {},
): CommandPaletteCommand => ({
    id: `panel-${tab}`,
    group: 'panel',
    title,
    description,
    keywords,
    icon,
    // The panel is part of the player surface; on home there is nothing for these to open.
    scope: 'player-surface',
    ...options,
    execute: (_input, context) => {
        context.panel.setPanelTab(tab);
        context.panel.setIsPanelOpen(true);
        return true;
    },
});

export const createVisualizerCommand = (
    mode: VisualizerMode,
    title: string,
    description: string,
    keywords: string[]
): CommandPaletteCommand => ({
    id: `visualizer-${mode}`,
    group: 'visualizer',
    title,
    description,
    keywords,
    execute: (_input, context) => {
        context.visualizer.setVisualizerMode(mode);
        return true;
    },
});

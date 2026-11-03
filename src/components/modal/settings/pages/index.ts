import type React from 'react';
import type { SettingsOptionDef } from '../kit';
import type { SettingsSectionId } from '../navigation/settingsNavModel';
import * as appearance from './AppearancePage';
import * as desktop from './DesktopPage';
import * as developer from './DeveloperPage';
import * as general from './GeneralPage';
import * as graphics from './GraphicsPage';
import * as home from './HomePage';
import * as integration from './IntegrationPage';
import * as interaction from './InteractionPage';
import * as lyrics from './LyricsPage';
import * as mods from './ModsPage';
import * as playback from './PlaybackPage';
import * as player from './PlayerPage';
import * as storage from './StoragePage';

// src/components/modal/settings/pages/index.ts
// The page of every settings category. A category in settingsNavModel without an entry here does
// not compile.

type PageModule = { default: React.FC; OPTIONS: readonly SettingsOptionDef[] };

/** Each category's page file. Its component and its options are read from the one file, so the two cannot be paired wrongly. */
const PAGE_MODULES: Record<SettingsSectionId, PageModule> = {
    appearance,
    player,
    home,
    playback,
    lyrics,
    general,
    interaction,
    integration,
    storage,
    desktop,
    graphics,
    mods,
    developer,
};

const fromPages = <T>(read: (page: PageModule) => T) => (
    Object.fromEntries(Object.entries(PAGE_MODULES).map(([section, page]) => [section, read(page)])) as Record<SettingsSectionId, T>
);

/** What the dialog draws for a category. */
export const SETTINGS_PAGES: Record<SettingsSectionId, React.FC> = fromPages(page => page.default);

/** The options each page declares, which is what the settings search can find on it. */
export const SETTINGS_PAGE_OPTIONS: Record<SettingsSectionId, readonly SettingsOptionDef[]> = fromPages(page => page.OPTIONS);

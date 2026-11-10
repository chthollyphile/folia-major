import { option, type SettingsGroupDef } from '../../kit';

// src/components/modal/settings/pages/integration/options.ts
// The groups and options of the 连接与集成 page, declared apart from the page so the files that
// draw its rows name the same ones. The ids other code opens the settings on (navidrome, r2Sync,
// discordRichPresence, scrobbleSettings, obsBrowserSource, lyricApi, stageMode) are rows here.

export const SERVICES: SettingsGroupDef = { id: 'services', titleKey: 'options.settingsHeadingServices' };
export const STREAMING: SettingsGroupDef = { id: 'streaming', titleKey: 'options.settingsHeadingStreaming' };


export const O = {
    navidrome: option(SERVICES, 'navidrome', 'navidrome.enable'),
    navidromeUrl: option(SERVICES, 'navidromeServerUrl', 'navidrome.serverUrl'),
    navidromeUsername: option(SERVICES, 'navidromeUsername', 'navidrome.username'),
    navidromePassword: option(SERVICES, 'navidromePassword', 'navidrome.password'),
    sync: option(SERVICES, 'r2Sync', 'options.r2Sync'),
    syncUrl: option(SERVICES, 'r2SyncWorkerUrl', 'options.r2SyncWorkerUrl'),
    syncToken: option(SERVICES, 'r2SyncToken', 'options.r2SyncToken'),
    discord: option(SERVICES, 'discordRichPresence', 'options.discordRichPresence', { electronOnly: true }),
    scrobble: option(SERVICES, 'scrobbleSettings', 'options.neteaseScrobble'),
    transparentBackground: option(STREAMING, 'transparentPlayerBackground', 'options.transparentPlayerBackground'),
    obs: option(STREAMING, 'obsBrowserSource', 'options.obsBrowserSource', { electronOnly: true }),
    obsKeepAnimation: option(STREAMING, 'obsKeepMainWindowAnimation', 'options.obsKeepMainWindowAnimation', { electronOnly: true }),
    lyricApi: option(STREAMING, 'lyricApi', 'options.lyricApi', { electronOnly: true }),
    stage: option(STREAMING, 'stageMode', 'options.stageMode'),
    stageSource: option(STREAMING, 'stageSource', 'options.stageSource'),
    playerCapAddress: option(STREAMING, 'playerCapAddress', 'options.playerCapAddress'),
    playerCapPlayer: option(STREAMING, 'playerCapPlayer', 'options.playerCapPlayer'),
    playerCapTimeline: option(STREAMING, 'playerCapTimeline', 'options.playerCapTimeline'),
    playerCapIgnoreClear: option(STREAMING, 'playerCapIgnoreClear', 'options.playerCapIgnoreClear'),
};

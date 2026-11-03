// src/stores/useStageSettingsStore.ts
// Stage / OBS / PlayerCap outputs: which external surfaces are enabled, how PlayerCap is
// addressed, and the now-playing pill's presentation.
//
// Split out of useSettingsUiStore.

import { create } from 'zustand';
import { getStoredBoolean, getStoredString, setStoredBoolean, setStoredString } from './storagePrimitives';
import { normalizeNowPlayingCardPosition, type NowPlayingCardPosition } from '../utils/nowPlayingCardPosition';
import { setStatusMessage } from './useStatusMessageStore';
import i18n from '../i18n/config';

export type StageTrackPillMode = 'auto' | 'always' | 'never';

// OBS overlay theme mode for the copied web OBS URL (default 'builtin' — per-song follow):
//   'static'  – bake the current theme into cfg (the original behavior; frozen in OBS).
//   'builtin' – bake no theme; the overlay derives a per-song builtin palette from the cover.
//   'ai'      – like 'builtin', plus the overlay regenerates an AI theme per song (opt-in).
const readStoredWebObsThemeMode = (): 'static' | 'builtin' | 'ai' => {
    if (typeof window === 'undefined') return 'builtin';
    const value = localStorage.getItem('web_obs_theme_mode') || 'builtin';
    return value === 'static' || value === 'ai' ? value : 'builtin';
};

const readStoredStageTrackPillMode = (): StageTrackPillMode => {
    if (typeof window === 'undefined') {
        return 'auto';
    }

    const saved = localStorage.getItem('stage_track_pill_mode');
    return saved === 'always' || saved === 'never' ? saved : 'auto';
};

const readStoredStageTrackPillTimeoutSec = (): number => {
    if (typeof window === 'undefined') {
        return 10;
    }

    const saved = Number(localStorage.getItem('stage_track_pill_timeout_sec'));
    return Number.isFinite(saved) && saved >= 3 && saved <= 60 ? Math.round(saved) : 10;
};

const STAGE_TRACK_PILL_POSITION_KEY = 'stage_track_pill_position';

const readStoredCardPosition = () => {
    try { return normalizeNowPlayingCardPosition(JSON.parse(getStoredString(STAGE_TRACK_PILL_POSITION_KEY, 'null'))); }
    catch { return null; }
};

export type StageSettingsState = {
    enableNowPlayingStage: boolean;
    // PlayerCap lyrics source (third stage source) config. enablePlayerCapStage is Web-only (Electron uses stageStatus.source).
    enablePlayerCapStage: boolean;
    playerCapHost: string;
    playerCapPlayer: string;
    playerCapTimeBasis: 'timestamp' | 'play_time';
    playerCapSticky: boolean;
    // Theme mode baked into the copied web OBS URL (static burn-in vs per-song dynamic; see readStoredWebObsThemeMode).
    webObsThemeMode: 'static' | 'builtin' | 'ai';
    /** 歌词页左下角曲目卡片显示模式：auto=显示一段时间后隐藏，always=常驻，never=不显示 */
    stageTrackPillMode: StageTrackPillMode;
    /** auto 模式下的显示时长（秒），3-60 */
    stageTrackPillTimeoutSec: number;
    stageTrackPillOnHome: boolean;
    /** null keeps the original bottom-bar alignment; otherwise coordinates are relative to the available viewport. */
    stageTrackPillPosition: NowPlayingCardPosition | null;
    handleSetStageTrackPillPosition: (position: NowPlayingCardPosition | null) => void;
    /** OBS 浏览器源有客户端连接时，主窗口是否继续渲染重动画（默认 false = 主窗口切到 still） */
    obsKeepMainWindowAnimation: boolean;
    // Web stage-source tri-state mutually-exclusive selection: null disables, else one of 'now-playing' or 'playercap'. Electron uses stageStatus.source.
    setWebStageSource: (source: 'now-playing' | 'playercap' | null) => void;
    setPlayerCapHost: (host: string) => void;
    setPlayerCapPlayer: (player: string) => void;
    setPlayerCapTimeBasis: (basis: 'timestamp' | 'play_time') => void;
    setPlayerCapSticky: (sticky: boolean) => void;
    setWebObsThemeMode: (mode: 'static' | 'builtin' | 'ai') => void;
    handleSetStageTrackPillMode: (mode: StageTrackPillMode) => void;
    handleSetStageTrackPillTimeoutSec: (sec: number) => void;
    handleToggleStageTrackPillOnHome: (enable: boolean) => void;
    handleToggleObsKeepMainWindowAnimation: (enable: boolean) => void;
};

export const useStageSettingsStore = create<StageSettingsState>((set, get) => ({
    enableNowPlayingStage: getStoredBoolean('enable_now_playing_stage', false),
    enablePlayerCapStage: getStoredBoolean('enable_playercap_stage', false),
    playerCapHost: getStoredString('playercap_host', 'localhost:8765'),
    playerCapPlayer: getStoredString('playercap_player', ''),
    playerCapTimeBasis: getStoredString('playercap_time_basis', 'play_time') === 'timestamp' ? 'timestamp' : 'play_time',
    playerCapSticky: getStoredBoolean('playercap_sticky', true),
    webObsThemeMode: readStoredWebObsThemeMode(),
    stageTrackPillMode: readStoredStageTrackPillMode(),
    stageTrackPillTimeoutSec: readStoredStageTrackPillTimeoutSec(),
    stageTrackPillOnHome: getStoredBoolean('stage_track_pill_on_home', false),
    stageTrackPillPosition: readStoredCardPosition(),
    handleSetStageTrackPillPosition: (position) => {
        const next = normalizeNowPlayingCardPosition(position);
        setStoredString(STAGE_TRACK_PILL_POSITION_KEY, JSON.stringify(next));
        set({ stageTrackPillPosition: next });
    },
    obsKeepMainWindowAnimation: getStoredBoolean('obs_keep_main_window_animation', false),
    setWebStageSource: (source) => {
        const wasEnabled = get().enableNowPlayingStage || get().enablePlayerCapStage;
        const enableNowPlaying = source === 'now-playing';
        const enablePlayerCap = source === 'playercap';
        setStoredBoolean('enable_now_playing_stage', enableNowPlaying);
        setStoredBoolean('enable_playercap_stage', enablePlayerCap);
        set({ enableNowPlayingStage: enableNowPlaying, enablePlayerCapStage: enablePlayerCap });
        const nowEnabled = enableNowPlaying || enablePlayerCap;
        // Only notify on the enable/disable transition; switching between the two sources is silent. On disable, the controller's stageSource→null reactive effect handles teardown automatically.
        if (wasEnabled !== nowEnabled) {
            setStatusMessage({
                type: 'info',
                text: i18n.t('notifications.' + (nowEnabled ? 'stageModeOn' : 'stageModeOff')),
            });
        }
    },
    setPlayerCapHost: (host) => {
        localStorage.setItem('playercap_host', host);
        set({ playerCapHost: host });
    },
    setPlayerCapPlayer: (player) => {
        localStorage.setItem('playercap_player', player);
        set({ playerCapPlayer: player });
    },
    setPlayerCapTimeBasis: (basis) => {
        localStorage.setItem('playercap_time_basis', basis);
        set({ playerCapTimeBasis: basis });
    },
    setPlayerCapSticky: (sticky) => {
        setStoredBoolean('playercap_sticky', sticky);
        set({ playerCapSticky: sticky });
    },
    setWebObsThemeMode: (mode) => {
        if (typeof window !== 'undefined') localStorage.setItem('web_obs_theme_mode', mode);
        set({ webObsThemeMode: mode });
    },
    handleSetStageTrackPillMode: (mode) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('stage_track_pill_mode', mode);
        }
        set({ stageTrackPillMode: mode });
    },
    handleSetStageTrackPillTimeoutSec: (sec) => {
        const next = Math.max(3, Math.min(60, Math.round(sec)));
        if (typeof window !== 'undefined') {
            localStorage.setItem('stage_track_pill_timeout_sec', String(next));
        }
        set({ stageTrackPillTimeoutSec: next });
    },
    handleToggleStageTrackPillOnHome: (enable) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('stage_track_pill_on_home', String(enable));
        }
        set({ stageTrackPillOnHome: enable });
    },
    handleToggleObsKeepMainWindowAnimation: (enable) => {
        setStoredBoolean('obs_keep_main_window_animation', enable);
        set({ obsKeepMainWindowAnimation: enable });
    },
}));

/**
 * The StageSettings half of the former settings snapshot, for the surfaces that
 * legitimately edit this whole domain at once. Ordinary consumers select one field instead.
 */
export const selectStageSettingsSnapshot = (state: StageSettingsState) => ({
    enableNowPlayingStage: state.enableNowPlayingStage,
    enablePlayerCapStage: state.enablePlayerCapStage,
    playerCapHost: state.playerCapHost,
    playerCapPlayer: state.playerCapPlayer,
    playerCapTimeBasis: state.playerCapTimeBasis,
    playerCapSticky: state.playerCapSticky,
    webObsThemeMode: state.webObsThemeMode,
    stageTrackPillMode: state.stageTrackPillMode,
    stageTrackPillTimeoutSec: state.stageTrackPillTimeoutSec,
    stageTrackPillOnHome: state.stageTrackPillOnHome,
    stageTrackPillPosition: state.stageTrackPillPosition,
    handleSetStageTrackPillPosition: state.handleSetStageTrackPillPosition,
    obsKeepMainWindowAnimation: state.obsKeepMainWindowAnimation,
    setWebStageSource: state.setWebStageSource,
    setPlayerCapHost: state.setPlayerCapHost,
    setPlayerCapPlayer: state.setPlayerCapPlayer,
    setPlayerCapTimeBasis: state.setPlayerCapTimeBasis,
    setPlayerCapSticky: state.setPlayerCapSticky,
    setWebObsThemeMode: state.setWebObsThemeMode,
    handleSetStageTrackPillMode: state.handleSetStageTrackPillMode,
    handleSetStageTrackPillTimeoutSec: state.handleSetStageTrackPillTimeoutSec,
    handleToggleStageTrackPillOnHome: state.handleToggleStageTrackPillOnHome,
    handleToggleObsKeepMainWindowAnimation: state.handleToggleObsKeepMainWindowAnimation,
});

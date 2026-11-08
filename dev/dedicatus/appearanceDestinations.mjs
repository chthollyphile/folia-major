// dev/dedicatus/appearanceDestinations.mjs
// D511 的登记表：外观类 store 的每个持久化键要去哪儿。
// - { config: '字段' }：进外观配置码（appearanceCodec.ts 的 compressConfig 编码这个字段，导入时 visualConfigTransfer 认它）；
// - { config: null, why }：不进，写明原因。新的例外必须是用户明确的决定（skill settings-feature-integration），并在 store 里写 @note。
// 外观类 store 是 visualConfigTransfer.ts 导入的 store，加上 visualizerSettingsPersistence.ts；新的外观 store 要接进 visualConfigTransfer。
// 各个歌词样式、背景自己的 tuning 键（*_tuning）经 applyVisualizerTuningsToSettings 整体导入导出，不在这里。
// 初始名单是 2026-11-08 的现状：按名字对上配置码字段的记成 config，对不上的标“待复核”，复核后写明去向。
// 检查在 test/unit/dedicatus/contracts/appearanceConfig.test.ts。

/** 外观类 store 之外、也要登记去向的文件。 */
export const EXTRA_VISUAL_STORE_FILES = ['src/stores/visualizerSettingsPersistence.ts'];

/** @type {Record<string, { config: string } | { config: null, why: string }>} */
export const APPEARANCE_DESTINATIONS = {
    // src/stores/useLatticeSettingsStore.ts
    'lattice_auto_focus_on_song_change': { config: null, why: '现状：名字对不上配置码的字段（待复核）' },
    'lattice_badge_current_only': { config: 'latticeBadgeCurrentOnly' },
    'lattice_lights_on': { config: null, why: '现状：名字对不上配置码的字段（待复核）' },
    'lattice_poster_tint_color': { config: null, why: '现状：名字对不上配置码的字段（待复核）' },
    'lattice_poster_tint_enabled': { config: null, why: '现状：名字对不上配置码的字段（待复核）' },
    'lattice_poster_tint_intensity': { config: null, why: '现状：名字对不上配置码的字段（待复核）' },
    'lattice_poster_tint_use_custom_color': { config: null, why: '现状：名字对不上配置码的字段（待复核）' },
    'lattice_vignette': { config: null, why: '现状：名字对不上配置码的字段（待复核）' },
    'wall_tools_queue_island_open': { config: null, why: '现状：名字对不上配置码的字段（待复核）' },
    // src/stores/useLibraryWallLookStore.ts
    'library_wall_backdrop_blur': { config: 'libraryWallBackdropBlur' },
    'library_wall_backdrop_lyrics': { config: 'libraryWallBackdropLyrics' },
    'library_wall_look': { config: null, why: '用户决定不进（2026-10-06，useLibraryWallLookStore.ts 的 @note）' },
    'library_wall_seam_clear': { config: 'libraryWallSeamClear' },
    'library_wall_seam_direction': { config: 'libraryWallSeamDirection' },
    'library_wall_seam_style': { config: 'libraryWallSeamStyle' },
    'library_wall_stack_edges': { config: 'libraryWallStackEdges' },
    'library_wall_windows_per_block': { config: null, why: '用户决定不进（2026-10-06，useLibraryWallLookStore.ts 的 @note）' },
    // src/stores/usePlayerChromeSettingsStore.ts
    'always_show_main_window_titlebar': { config: null, why: '现状：名字对不上配置码的字段（待复核）' },
    'always_show_player_back_button': { config: null, why: '现状：名字对不上配置码的字段（待复核）' },
    'always_show_track_switch_buttons': { config: null, why: '现状：名字对不上配置码的字段（待复核）' },
    'auto_hide_cursor_with_player_chrome': { config: null, why: '现状：名字对不上配置码的字段（待复核）' },
    'auto_hide_player_chrome': { config: null, why: '现状：名字对不上配置码的字段（待复核）' },
    'enable_player_page_native_blur': { config: null, why: '现状：名字对不上配置码的字段（待复核）' },
    'hide_cursor_when_idle': { config: null, why: '现状：名字对不上配置码的字段（待复核）' },
    'hide_fullscreen_button': { config: null, why: '现状：名字对不上配置码的字段（待复核）' },
    'hide_player_progress_bar': { config: null, why: '现状：名字对不上配置码的字段（待复核）' },
    'hide_player_right_panel_button': { config: null, why: '现状：名字对不上配置码的字段（待复核）' },
    'player_bottom_bar_offset': { config: null, why: '现状：名字对不上配置码的字段（待复核）' },
    'player_control_slot_primary': { config: null, why: '现状：名字对不上配置码的字段（待复核）' },
    'player_control_slot_secondary': { config: null, why: '现状：名字对不上配置码的字段（待复核）' },
    'player_header_blur': { config: 'playerHeaderBlur' },
    'show_open_panel_close_button': { config: null, why: '现状：名字对不上配置码的字段（待复核）' },
    'transparent_player_background': { config: null, why: '现状：名字对不上配置码的字段（待复核）' },
    'use_native_mac_fullscreen_button': { config: null, why: '现状：名字对不上配置码的字段（待复核）' },
    // src/stores/useScratchpadSettingsStore.ts
    'scratchpad_handle_position': { config: null, why: '现状：名字对不上配置码的字段（待复核）' },
    'scratchpad_handle_style': { config: 'scratchpadHandleStyle' },
    'scratchpad_show_handle': { config: null, why: '现状：名字对不上配置码的字段（待复核）' },
    // src/stores/useStageSettingsStore.ts
    'enable_now_playing_stage': { config: null, why: '现状：名字对不上配置码的字段（待复核）' },
    'enable_playercap_stage': { config: null, why: '现状：名字对不上配置码的字段（待复核）' },
    'obs_keep_main_window_animation': { config: null, why: '现状：名字对不上配置码的字段（待复核）' },
    'playercap_host': { config: null, why: '现状：名字对不上配置码的字段（待复核）' },
    'playercap_player': { config: null, why: '现状：名字对不上配置码的字段（待复核）' },
    'playercap_sticky': { config: null, why: '现状：名字对不上配置码的字段（待复核）' },
    'playercap_time_basis': { config: null, why: '现状：名字对不上配置码的字段（待复核）' },
    'stage_track_pill_in_obs': { config: 'stageTrackPillInObs' },
    'stage_track_pill_mode': { config: 'stageTrackPillMode' },
    'stage_track_pill_on_home': { config: 'stageTrackPillOnHome' },
    'stage_track_pill_position': { config: 'stageTrackPillPosition' },
    'stage_track_pill_timeout_sec': { config: 'stageTrackPillTimeoutSec' },
    'web_obs_theme_mode': { config: null, why: '现状：名字对不上配置码的字段（待复核）' },
    // src/stores/useThemeSettingsStore.ts
    'default_theme_daylight': { config: null, why: '现状：名字对不上配置码的字段（待复核）' },
    'disable_home_dynamic_background': { config: null, why: '现状：名字对不上配置码的字段（待复核）' },
    'enable_home_dynamic_background': { config: null, why: '现状：名字对不上配置码的字段（待复核）' },
    'follow_system_theme': { config: 'followSystemTheme' },
    'static_mode': { config: 'staticMode' },
    'use_cover_color_bg': { config: 'useCoverColorBg' },
    // src/stores/useTypographySettingsStore.ts
    'harmony_subtitle_background': { config: 'harmonySubtitleBackground' },
    'hide_player_translation_subtitle': { config: 'hidePlayerTranslationSubtitle' },
    'lyrics_custom_font': { config: 'lyricsCustomFontFamily' },
    'lyrics_font_fallback_families': { config: 'lyricsFontFallbackFamilies' },
    'lyrics_font_scale': { config: 'lyricsFontScale' },
    'lyrics_font_style': { config: 'lyricsFontStyle' },
    'lyrics_font_weight': { config: 'lyricsFontWeight' },
    'show_harmony_subtitle': { config: 'showHarmonySubtitle' },
    'show_subtitle_translation': { config: 'showSubtitleTranslation' },
    'subtitle_content_mode': { config: 'subtitleContentMode' },
    'subtitle_font_fallback_families': { config: 'subtitleFontFallbackFamilies' },
    'subtitle_font_family': { config: 'subtitleFontFamily' },
    'subtitle_font_inherits_lyrics': { config: 'subtitleFontInheritsLyrics' },
    'subtitle_font_scale': { config: 'subtitleFontScale' },
    'subtitle_font_style': { config: 'subtitleFontStyle' },
    'subtitle_font_weight': { config: 'subtitleFontWeight' },
    'subtitle_overlay_background': { config: 'subtitleOverlayBackground' },
    'subtitle_overlay_layout': { config: 'subtitleOverlayLayout' },
    'subtitle_overlay_opacity': { config: 'subtitleOverlayOpacity' },
    'subtitle_upcoming_lyrics_blur': { config: 'subtitleUpcomingLyricsBlur' },
    // src/stores/useVisualizerAssetStore.ts
    // src/stores/useVisualizerSettingsStore.ts
    'background_opacity': { config: 'backgroundOpacity' },
    'disable_visualizer_geometric_background': { config: 'disableVisualizerGeometricBackground' },
    'disable_visualizer_vignette': { config: 'disableVisualizerVignette' },
    'lyric_render_quality': { config: null, why: '现状：名字对不上配置码的字段（待复核）' },
    'random_visualizer_mode_per_song': { config: 'randomVisualizerModePerSong' },
    'random_visualizer_modes': { config: 'randomVisualizerModes' },
    'visualizer_background_mode': { config: 'visualizerBackgroundMode' },
    'visualizer_frame_rate': { config: null, why: '现状：名字对不上配置码的字段（待复核）' },
    'visualizer_glow_blur_quantize': { config: null, why: '现状：名字对不上配置码的字段（待复核）' },
    'visualizer_mode': { config: 'visualizerMode' },
    'visualizer_opacity': { config: 'visualizerOpacity' },
    'visualizer_smart_beat': { config: 'smartBeat' },
    // src/stores/visualizerSettingsPersistence.ts
};

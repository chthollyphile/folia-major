// src/services/settingsTransfer/settingsCatalog.ts
// Everything a whole-settings export may carry, and everything it must not.
//
// The visual config code (utils/appearanceCodec.ts) stays as it is: it is also the shortcode the
// web build's OBS quick import reads, so its shape cannot grow. This catalog is the separate,
// wider document: one entry per stored setting, sorted into the groups a person would look for it
// under, plus the keys that are deliberately left out and the reason each one is.
//
// A setting reaches a listener's other machine only if it is listed here, so a new setting that is
// not listed is a silent loss. test/unit/settingsTransfer/settingsCatalogCoverage.test.ts reads the
// stores' source and fails on a key that is in neither list — that is the reminder to decide.
//
// Credentials are not a judgement call here: no token, cookie, API key or endpoint is stored under
// a key in src/stores. Those live in the main process and in the mods' secret store, which this
// module never reads. The exclusion list below is about device-local values, session state and
// one-time confirmations, not about secrets.

/** The group a setting is shown under when a bundle is read, and picked by when one is taken. */
export type SettingsGroupId =
    | 'appearance'
    | 'player'
    | 'home'
    | 'lyrics'
    | 'playback'
    | 'interaction'
    | 'general'
    | 'integration'
    | 'storage'
    | 'desktop'
    | 'graphics'
    | 'mods';

/** How the stored string is read back, so a hand-edited bundle cannot write a value the stores cannot read. */
export type SettingsValueType = 'boolean' | 'number' | 'json' | 'string';

export type SettingsCatalogEntry = {
    /** The localStorage key, written and read verbatim: published keys are never renamed. */
    key: string;
    group: SettingsGroupId;
    type: SettingsValueType;
    /** For a key whose meaning needs a word: what it holds. */
    note?: string;
};

export type ExcludedSettingsEntry = {
    key: string;
    /** Why it stays on the machine it was written on. Shown nowhere; read by whoever revisits this. */
    reason: string;
};

/** The groups in the order the export dialog lists them. */
export const SETTINGS_GROUPS: SettingsGroupId[] = [
    'appearance',
    'player',
    'home',
    'lyrics',
    'playback',
    'interaction',
    'general',
    'integration',
    'storage',
    'desktop',
    'graphics',
    'mods',
];

const entry = (key: string, group: SettingsGroupId, type: SettingsValueType, note?: string): SettingsCatalogEntry => (
    note === undefined ? { key, group, type } : { key, group, type, note }
);

export const SETTINGS_CATALOG: SettingsCatalogEntry[] = [
    // 外观
    entry('visualizer_mode', 'appearance', 'string'),
    entry('visualizer_background_mode', 'appearance', 'string'),
    entry('background_opacity', 'appearance', 'number'),
    entry('follow_system_theme', 'appearance', 'boolean'),
    entry('enable_home_dynamic_background', 'appearance', 'boolean'),
    entry('disable_home_dynamic_background', 'appearance', 'boolean'),
    entry('player_chrome_hidden', 'appearance', 'boolean'),

    // 播放页
    entry('auto_hide_player_chrome', 'player', 'boolean'),
    entry('player_bottom_bar_offset', 'player', 'number'),
    entry('player_control_slot_primary', 'player', 'string'),
    entry('player_control_slot_secondary', 'player', 'string'),
    entry('playercap_host', 'player', 'string'),
    entry('playercap_player', 'player', 'string'),
    entry('playercap_time_basis', 'player', 'string'),
    entry('stage_track_pill_mode', 'player', 'string'),
    entry('stage_track_pill_timeout_sec', 'player', 'number'),
    entry('stage_track_pill_position', 'player', 'string'),
    entry('stage_track_pill_on_home', 'player', 'boolean'),
    entry('stage_track_pill_in_obs', 'player', 'boolean'),
    entry('video_layer_enabled', 'player', 'boolean'),
    entry('video_layer_fit', 'player', 'string'),
    entry('video_layer_opacity', 'player', 'number'),
    entry('video_layer_url', 'player', 'string'),

    // 主页与歌单
    entry('home_layout_style', 'home', 'string'),
    entry('grid3d_card_style', 'home', 'string'),
    entry('show_home_tab_albums', 'home', 'boolean'),
    entry('show_home_tab_explore', 'home', 'boolean'),
    entry('show_home_tab_local', 'home', 'boolean'),
    entry('show_home_tab_playlist', 'home', 'boolean'),
    entry('show_home_tab_radio', 'home', 'boolean'),
    entry('gridview_full_bleed_cover', 'home', 'boolean'),
    entry('gridview_min_card_opacity', 'home', 'number'),
    entry('gridview_min_card_scale', 'home', 'number'),
    entry('gridview_square_cards', 'home', 'boolean'),
    // Bravais 墙面。look 与 windowsPerBlock 是用户明确决定不进外观配置码的例外
    // （见 skills/settings-feature-integration/SKILL.md），但它们仍是可移植的显示偏好，
    // 在这个更宽的全量导出里跟着走。
    entry('library_wall_look', 'home', 'string'),
    entry('library_wall_windows_per_block', 'home', 'number'),
    entry('library_wall_stack_edges', 'home', 'boolean'),
    entry('library_wall_seam_clear', 'home', 'boolean'),
    entry('library_wall_seam_style', 'home', 'string'),
    entry('library_wall_seam_direction', 'home', 'string'),
    entry('library_wall_backdrop_lyrics', 'home', 'boolean'),
    entry('library_wall_backdrop_blur', 'home', 'boolean'),
    entry('lattice_auto_focus_on_song_change', 'home', 'boolean'),
    entry('lattice_badge_current_only', 'home', 'boolean'),
    entry('lattice_lights_on', 'home', 'boolean'),
    entry('lattice_vignette', 'home', 'boolean'),
    entry('lattice_poster_tint_enabled', 'home', 'boolean'),
    entry('lattice_poster_tint_use_custom_color', 'home', 'boolean'),
    entry('lattice_poster_tint_color', 'home', 'string'),
    entry('lattice_poster_tint_intensity', 'home', 'number'),
    // Which library UI suite the collection pages are drawn with. A UI preference, which is why it
    // stays out of the visual config code (see skills/settings-feature-integration/SKILL.md), but
    // it is exactly the kind of choice a person wants on their other machine.
    entry('library_suite', 'home', 'string'),
    // Which kind of daily recommendations the daily page opens on.
    entry('folia.dailyRecommendations.mode', 'home', 'string'),
    // How the local library's track list is ordered.
    entry('local_track_sort_field', 'home', 'string'),
    entry('local_track_sort_direction', 'home', 'string'),

    // 歌词
    entry('global_lyric_timeline_offset_ms', 'lyrics', 'number'),
    entry('local_lyric_format_order', 'lyrics', 'json'),
    entry('local_lyrics_priority', 'lyrics', 'string'),
    entry('preferred_alternative_lyric_source', 'lyrics', 'string'),
    entry('lyrics_font_style', 'lyrics', 'string'),
    entry('lyrics_font_scale', 'lyrics', 'number'),
    entry('lyrics_font_weight', 'lyrics', 'number'),
    entry('lyrics_font_fallback_families', 'lyrics', 'json'),
    // 上传的字体文件不跟着走，只有系统字体族名可以移植。
    entry('lyrics_custom_font', 'lyrics', 'json', 'name of a system font; the uploaded file itself is not carried'),
    entry('lyrics_filter_enabled', 'lyrics', 'boolean'),
    entry('lyrics_filter_pattern', 'lyrics', 'string'),
    entry('lyrics_filter_rules', 'lyrics', 'json'),
    entry('lyrics_staff_absorb_mode', 'lyrics', 'string'),
    entry('lyrics_staff_min_dwell', 'lyrics', 'number'),
    entry('lyrics_staff_pattern', 'lyrics', 'string'),
    entry('lyrics_staff_policy', 'lyrics', 'string'),
    entry('show_harmony_subtitle', 'lyrics', 'boolean'),
    entry('harmony_subtitle_background', 'lyrics', 'boolean'),
    entry('show_subtitle_translation', 'lyrics', 'boolean'),
    entry('subtitle_content_mode', 'lyrics', 'string'),
    entry('subtitle_overlay_layout', 'lyrics', 'string'),
    entry('subtitle_overlay_background', 'lyrics', 'boolean'),
    entry('subtitle_overlay_opacity', 'lyrics', 'number'),
    entry('subtitle_upcoming_lyrics_blur', 'lyrics', 'boolean'),
    entry('subtitle_font_inherits_lyrics', 'lyrics', 'boolean'),
    entry('subtitle_font_family', 'lyrics', 'string'),
    entry('subtitle_font_style', 'lyrics', 'string'),
    entry('subtitle_font_weight', 'lyrics', 'number'),
    entry('subtitle_font_scale', 'lyrics', 'number'),
    entry('subtitle_font_fallback_families', 'lyrics', 'json'),

    // 播放控制
    entry('default_audio_quality', 'playback', 'string'),
    entry('folia_auto_skip_unplayable', 'playback', 'boolean'),
    entry('folia_auto_play_on_launch', 'playback', 'boolean'),
    entry('folia_automix_enabled', 'playback', 'boolean'),
    entry('folia_crossfade_max_sec', 'playback', 'number'),
    entry('folia_enable_transcode_fallback', 'playback', 'boolean'),
    entry('folia_playback_fade_enabled', 'playback', 'boolean'),
    entry('folia_netease_scrobble', 'playback', 'boolean'),
    entry('local_replaygain_mode', 'playback', 'string'),
    entry('queue_add_behavior', 'playback', 'string'),
    entry('folia_audio_equalizer_mod_curve', 'playback', 'json'),
    entry('folia_transition_mode', 'playback', 'string'),
    entry('folia_transition_animation', 'playback', 'boolean'),
    entry('folia_transition_animation_card', 'playback', 'boolean'),
    entry('folia_transition_performance', 'playback', 'boolean'),
    entry('folia.personalFm.selection', 'playback', 'string'),
    entry('folia.personalFm.providerSelections', 'playback', 'json'),
    entry('folia_hifi_enabled', 'playback', 'boolean'),
    entry('folia_hifi_exclusive', 'playback', 'boolean'),
    entry('folia_hifi_dsd_mode', 'playback', 'string'),
    entry('folia_hifi_software_volume', 'playback', 'boolean'),
    entry('folia_hifi_navidrome', 'playback', 'boolean'),

    // 快捷操作
    entry('custom_shortcut_command', 'interaction', 'string'),
    entry('custom_shortcut_letter', 'interaction', 'string'),
    entry('global_shortcut_bindings', 'interaction', 'json'),
    entry('global_shortcut_portal_enabled', 'interaction', 'boolean'),
    entry('grid_action_button_slide_target', 'interaction', 'string'),
    entry('grid_command_palette_hotkey', 'interaction', 'boolean'),
    entry('queue_palette_keep_open', 'interaction', 'boolean'),

    // 通用
    entry('ponder_hint_visibility', 'general', 'string'),
    entry('ponder_touch_button', 'general', 'string'),

    // 连接与集成
    entry('web_obs_theme_mode', 'integration', 'string'),

    // 存储与备份
    entry('enable_media_cache', 'storage', 'boolean'),
    entry('folia_enable_media_cache', 'storage', 'boolean'),
    entry('folia_cache_size', 'storage', 'number'),
    entry('folia_media_cache_limit_gb', 'storage', 'number'),
    entry('local_library_auto_scan', 'storage', 'boolean'),

    // 桌面
    entry('close_to_tray', 'desktop', 'boolean'),
    entry('minimize_to_tray', 'desktop', 'boolean'),
    entry('hide_taskbar_icon', 'desktop', 'boolean'),
    entry('open_player_on_launch', 'desktop', 'boolean'),
    entry('prevent_display_sleep_during_playback', 'desktop', 'boolean'),
    entry('voice_input_pause_enabled', 'desktop', 'boolean'),
    entry('background_throttling', 'desktop', 'boolean'),
    entry('wallpaper_mode', 'desktop', 'boolean'),
    entry('wallpaper_mac_autohide_dock', 'desktop', 'boolean'),
    entry('remote_control_skip_taskbar', 'desktop', 'boolean'),
    entry('remote_control_hide_titlebar', 'desktop', 'boolean'),
    entry('remote_control_click_through', 'desktop', 'boolean'),
    entry('remote_control_expand_cover', 'desktop', 'boolean'),
    entry('remote_control_text_shade', 'desktop', 'boolean'),

    // 性能与动效
    entry('gpu_preference', 'graphics', 'string'),
    entry('reduce_motion_follow_system', 'graphics', 'boolean'),
    entry('reduce_motion_collectionMorph', 'graphics', 'boolean'),
    entry('reduce_motion_lattice', 'graphics', 'boolean'),
    entry('reduce_motion_monetBackground', 'graphics', 'boolean'),
    entry('reduce_motion_settingsScroll', 'graphics', 'boolean'),
    entry('reduce_motion_transitionOverlay', 'graphics', 'boolean'),
    entry('reduce_motion_uiMicroMotion', 'graphics', 'boolean'),

    // 模组
    entry('mod_system_enabled', 'mods', 'boolean'),
];

/**
 * Keys that are stored next to the settings but are not settings: a value that belongs to the
 * machine (an output device, a path), a session's state, or a one-time confirmation. Taking
 * another machine's value for one of these is at best meaningless and at worst wrong — the device
 * it names is not there.
 */
export const SETTINGS_EXCLUDED: ExcludedSettingsEntry[] = [
    // 本机设备与路径
    { key: 'audio_output_device_id', reason: 'names an output device of this machine' },
    { key: 'folia_hifi_audio_device', reason: "mpv audio-device value of this machine" },
    { key: 'folia_hifi_audio_device_label', reason: 'display name of this machine\u2019s device' },
    { key: 'folia_hifi_mpv_path', reason: 'absolute path of an mpv binary on this machine' },
    // 一次性确认
    { key: 'folia_hifi_volume_confirmed', reason: 'one-time confirmation, not a preference' },
    { key: 'wallpaper_entry_confirmed', reason: 'one-time confirmation, not a preference' },
    // 引导与提示的已读状态
    { key: 'folia_last_seen_ponder_onboarding_version', reason: 'onboarding progress of this install' },
    { key: 'folia_ponder_seen', reason: 'onboarding progress of this install' },
    { key: 'library_suite_prompt_seen', reason: 'onboarding progress of this install' },
    // 会话与运行态
    { key: 'active_online_provider_id', reason: 'the account session this install is on' },
    { key: 'folia_playback_source', reason: 'what is playing right now' },
    { key: 'player_volume', reason: 'current volume, not a preference to carry over' },
    { key: 'player_loop_mode', reason: 'current loop mode of the queue' },
    { key: 'sleep_timer_hours', reason: 'a countdown that is already running' },
    { key: 'sleep_timer_minutes', reason: 'a countdown that is already running' },
    { key: 'last_home_view_tab', reason: 'which tab was open last' },
    { key: 'playback_entry_view', reason: 'which view was open last' },
    { key: 'playback_entry_view_chosen', reason: 'which view was chosen on this install' },
    { key: 'wall_tools_queue_island_open', reason: 'a panel that happened to be open' },
    { key: 'folia_navidrome_last_section', reason: 'which section of the Navidrome home was open last' },
    // 用户内容，不是设置
    { key: 'folia_scratchpad_entries', reason: 'the user\u2019s own notes, not a setting' },
    { key: 'hidden_grid_playlists', reason: 'names library entries by id; another machine may not have them' },
];

const CATALOG_BY_KEY = new Map(SETTINGS_CATALOG.map(item => [item.key, item]));

export const settingsCatalogEntry = (key: string): SettingsCatalogEntry | undefined => CATALOG_BY_KEY.get(key);

export const settingsCatalogKeys = (): string[] => SETTINGS_CATALOG.map(item => item.key);

/** The catalog's entries of one group, in catalog order. */
export const settingsCatalogGroup = (group: SettingsGroupId): SettingsCatalogEntry[] => (
    SETTINGS_CATALOG.filter(item => item.group === group)
);

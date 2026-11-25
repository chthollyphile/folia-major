// src/services/settingsTransfer/settingsCatalog.ts
// Everything a whole-settings export may carry, and everything it must not.
//
// The visual config code (utils/appearanceCodec.ts) stays as it is: it is also the shortcode the
// web build's OBS quick import reads, so its shape cannot grow. This catalog is the separate,
// wider document: one entry per stored setting, sorted into the groups a person would look for it
// under, plus the keys that are deliberately left out and the reason each one is.
//
// Two lists leave a key behind, and the difference is why it is left:
//   SETTINGS_EXCLUDED          the value belongs to this machine and must not travel.
//   SETTINGS_VISUAL_CONFIG_KEYS the value does travel, but in the visual config code's shortcode.
//
// A key the shortcode carries is never carried here as well: one setting reaches the other machine
// one way, so importing both documents in either order gives the same result. Which keys the
// shortcode carries is not decided in this file — dev/dedicatus/appearanceDestinations.mjs (D511)
// is its field table, key by key, and the coverage test fails when this list stops matching it.
//
// A setting reaches a listener's other machine only if it is listed in one of the three, so a new
// setting that is in none of them is a silent loss. test/unit/settingsTransfer/
// settingsCatalogCoverage.test.ts reads the stores' source — every use*Store.ts under src, plus the
// persistence file the stores read through — and fails on such a key: that is the reminder to decide.
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
    entry('disable_home_dynamic_background', 'appearance', 'boolean'),
    entry('player_chrome_hidden', 'appearance', 'boolean'),
    entry('default_theme_daylight', 'appearance', 'boolean'),
    // The theme the listener last picked by hand, kept apart from the one following the system.
    entry('custom_theme_preferred', 'appearance', 'boolean'),
    // The 3D scene and its room sound. Deliberately not in the visual config code either (the web
    // OBS page has no scene), so the wider bundle is their only way across.
    entry('scene_id', 'appearance', 'string'),
    entry('scene_options', 'appearance', 'json', 'per-scene options; the scene ids name scenes this build must also have'),
    entry('scene_room_sound', 'appearance', 'boolean'),
    entry('scene_room_output', 'appearance', 'string', "where the room sound is played: 'headphones' or 'speakers'"),

    // 播放页
    entry('auto_hide_player_chrome', 'player', 'boolean'),
    entry('player_bottom_bar_offset', 'player', 'number'),
    entry('player_control_slot_primary', 'player', 'string'),
    entry('player_control_slot_secondary', 'player', 'string'),
    entry('player_capsule_island', 'player', 'json', 'the capsule island\u2019s buttons, in order, as an array'),
    entry('playercap_host', 'player', 'string'),
    entry('playercap_player', 'player', 'string'),
    entry('playercap_time_basis', 'player', 'string'),
    entry('video_layer_enabled', 'player', 'boolean'),
    entry('video_layer_fit', 'player', 'string'),
    entry('video_layer_opacity', 'player', 'number'),
    entry('video_layer_url', 'player', 'string'),
    // The player page's own chrome. None of it is in the visual config code: the web OBS page draws
    // no player chrome, so the shortcode has no field for these and the wider bundle is their only
    // way across (2026-11-08 decision, dev/dedicatus/appearanceDestinations.mjs).
    entry('always_show_main_window_titlebar', 'player', 'boolean'),
    entry('always_show_player_back_button', 'player', 'boolean'),
    entry('always_show_track_switch_buttons', 'player', 'boolean'),
    entry('auto_hide_cursor_with_player_chrome', 'player', 'boolean'),
    entry('enable_player_page_native_blur', 'player', 'boolean', 'also written to the main process on desktop, which needs the same value on the other machine'),
    entry('hide_cursor_when_idle', 'player', 'boolean'),
    entry('hide_fullscreen_button', 'player', 'boolean'),
    entry('hide_player_progress_bar', 'player', 'boolean'),
    entry('hide_player_right_panel_button', 'player', 'boolean'),
    entry('progress_bar_chorus_marker', 'player', 'boolean'),
    entry('show_open_panel_close_button', 'player', 'boolean'),
    entry('transparent_player_background', 'player', 'boolean'),
    entry('use_native_mac_fullscreen_button', 'player', 'boolean'),
    entry('use_native_mac_traffic_lights', 'player', 'boolean'),
    entry('window_titlebar_side', 'player', 'string', "which side the window controls sit on: 'left' or 'right'"),
    // The stage and the now playing card's switches.
    entry('enable_now_playing_stage', 'player', 'boolean'),
    entry('enable_playercap_stage', 'player', 'boolean'),
    entry('playercap_sticky', 'player', 'boolean'),
    entry('obs_keep_main_window_animation', 'player', 'boolean'),

    // 主页与歌单
    entry('home_layout_style', 'home', 'string'),
    entry('grid3d_card_style', 'home', 'string'),
    entry('show_home_tab_albums', 'home', 'boolean'),
    entry('show_home_tab_explore', 'home', 'boolean'),
    entry('show_home_tab_folia', 'home', 'boolean'),
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
    entry('library_wall_home_finite', 'home', 'boolean'),
    entry('lattice_auto_focus_on_song_change', 'home', 'boolean'),
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
    // The scratchpad's handle is a panel control, not the notes themselves (those are the user's
    // own text and stay on the machine: SETTINGS_EXCLUDED below).
    entry('scratchpad_show_handle', 'home', 'boolean'),
    entry('scratchpad_handle_position', 'home', 'number', '0 to 1 down the left edge; a percentage, stored as its decimal'),
    entry('remember_home_card_position', 'home', 'boolean'),
    // The lattice wall's shape and its radio card's question tiles: options of the queue collage,
    // which the web OBS page does not draw, so they are not in the visual config code either.
    entry('lattice_wall_form', 'home', 'string'),
    entry('lattice_radio_hide_upcoming', 'home', 'boolean'),
    entry('library_wall_collection_tilt', 'home', 'boolean'),

    // 歌词
    entry('local_lyric_format_order', 'lyrics', 'json'),
    entry('local_lyrics_priority', 'lyrics', 'string'),
    entry('preferred_alternative_lyric_source', 'lyrics', 'string'),
    // 上传的字体文件不跟着走，只有系统字体族名可以移植。
    entry('lyrics_filter_enabled', 'lyrics', 'boolean'),
    entry('lyrics_filter_pattern', 'lyrics', 'string'),
    entry('lyrics_filter_rules', 'lyrics', 'json'),
    entry('lyrics_staff_absorb_mode', 'lyrics', 'string'),
    entry('lyrics_staff_min_dwell', 'lyrics', 'number'),
    entry('lyrics_staff_pattern', 'lyrics', 'string'),
    entry('lyrics_staff_policy', 'lyrics', 'string'),
    entry('auto_use_best_lyric', 'lyrics', 'boolean'),
    entry('lyrics_auto_ai_segmentation', 'lyrics', 'boolean', 'runs a paid AI segmentation pass per song; off by default'),
    entry('lyrics_keep_provider_word_timing', 'lyrics', 'boolean'),
    entry('preferred_alternative_lyric_source_v2', 'lyrics', 'string', 'the versioned key of the fallback lyric source'),

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
    // A normalised object, stored as its JSON text (usePersonalFmModeStore.ts); carrying it as a
    // string would put an escaped blob in the file instead of a readable shape.
    entry('folia.personalFm.selection', 'playback', 'json'),
    entry('folia.personalFm.providerSelections', 'playback', 'json'),
    entry('folia_hifi_enabled', 'playback', 'boolean'),
    entry('folia_hifi_exclusive', 'playback', 'boolean'),
    entry('folia_hifi_dsd_mode', 'playback', 'string'),
    entry('folia_hifi_software_volume', 'playback', 'boolean'),
    entry('folia_hifi_navidrome', 'playback', 'boolean'),
    entry('audio_equalizer_settings', 'playback', 'json', 'the ten-band equalizer model'),
    entry('folia_shuffle_round_no_repeat', 'playback', 'boolean'),
    entry('folia_stem_mixer_enabled', 'playback', 'boolean'),
    entry('folia_stem_mixer_gains', 'playback', 'json', 'per-stem gain of the mixer'),

    // 快捷操作
    entry('custom_shortcut_command', 'interaction', 'string'),
    entry('custom_shortcut_letter', 'interaction', 'string'),
    entry('global_shortcut_bindings', 'interaction', 'json'),
    entry('global_shortcut_portal_enabled', 'interaction', 'boolean'),
    entry('grid_action_button_slide_target', 'interaction', 'string'),
    entry('grid_command_palette_hotkey', 'interaction', 'boolean'),
    entry('queue_palette_keep_open', 'interaction', 'boolean'),
    entry('visualizer_picker_keep_open', 'interaction', 'boolean'),

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

    // 桌面。The tray, window and wallpaper switches are the main process's own values: it sends
    // them on launch and setDesktopPreferenceSnapshot writes them over localStorage, so a value
    // this bundle wrote would be replaced before the reload finished. They are listed in
    // SETTINGS_EXCLUDED with that reason; a later PR can write them through the store setters.
    // What stays here is the interface's own preference, which no process overrides.
    entry('open_player_on_launch', 'desktop', 'boolean'),
    entry('ui_zoom_enabled', 'desktop', 'boolean'),
    entry('ui_zoom_step', 'desktop', 'string', 'one of the fixed interface scale percentages'),

    // 性能与动效
    entry('reduce_motion_follow_system', 'graphics', 'boolean'),
    entry('reduce_motion_collectionMorph', 'graphics', 'boolean'),
    entry('reduce_motion_lattice', 'graphics', 'boolean'),
    entry('reduce_motion_monetBackground', 'graphics', 'boolean'),
    entry('reduce_motion_settingsScroll', 'graphics', 'boolean'),
    entry('reduce_motion_transitionOverlay', 'graphics', 'boolean'),
    entry('reduce_motion_uiMicroMotion', 'graphics', 'boolean'),
    // Rendering cost knobs that the visual config code deliberately does not carry (2026-11-08
    // decision): the web OBS page cannot read this machine's settings, so they travel here only.
    entry('visualizer_frame_rate', 'graphics', 'string', "the canvas frame cap: 'off', 60, 90 or 120"),
    entry('visualizer_glow_blur_quantize', 'graphics', 'boolean'),

    // 模组：mod_system_enabled is the main process's switch (same snapshot as the tray switches),
    // so it is excluded too. What is left is the market's background update check, a preference of
    // the interface rather than of the main process, so it travels.
    entry('folia_mod_update_check', 'mods', 'boolean'),
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
    { key: 'folia_hifi_audio_device', reason: 'mpv audio-device value of this machine' },
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
    { key: 'last_home_online_tab', reason: 'which online tab was open last' },
    { key: 'add_to_playlist_last_pane', reason: 'the pane the add-to-playlist picker was left on' },
    { key: 'add_to_playlist_last_folia_playlist', reason: 'which playlist was added to last on this install' },
    { key: 'folia_mod_update_checked_at', reason: 'when the background update check last ran' },
    { key: 'playback_entry_view', reason: 'which view was open last' },
    { key: 'playback_entry_view_chosen', reason: 'which view was chosen on this install' },
    { key: 'wall_tools_queue_island_open', reason: 'a panel that happened to be open' },
    { key: 'folia_navidrome_last_section', reason: 'which section of the Navidrome home was open last' },
    // 用户内容，不是设置
    { key: 'folia_scratchpad_entries', reason: 'the user\u2019s own notes, not a setting' },
    { key: 'hidden_grid_playlists', reason: 'names library entries by id; another machine may not have them' },
    { key: 'folia_search_history_v1', reason: 'the terms this listener searched for, not a preference' },
    // A legacy key kept only so an install that never wrote its replacement still reads something:
    // the store reads it and never writes it, and the newer disable_home_dynamic_background wins
    // whenever it exists. Carrying it would give the bundle two answers to one question.
    { key: 'enable_home_dynamic_background', reason: 'a fallback shadowed by disable_home_dynamic_background; never written' },
    // The listening report setting is now stored per source, under `folia_playback_report:<source id>`:
    // a key whose second half is the source's id, which a list of literal keys cannot name, and whose
    // set of ids is the source registry's. The one source that keeps a fixed key — NetEase, as
    // folia_netease_scrobble — is in SETTINGS_CATALOG above and does travel; the others stay behind
    // until the export learns to carry a key with a variable part.
    { key: 'folia_playback_report:', reason: 'per source, under a key whose second half is the source id' },
    // The lyric timeline offset is a per-machine audio latency compensation, measured where the
    // sound is (useLyricSettingsStore.ts): applying another machine's offset desyncs this one.
    { key: 'global_lyric_timeline_offset_ms', reason: 'a latency measured on this machine\u2019s audio device' },
    { key: 'player_is_muted', reason: 'the mute state of a running player, like the volume next to it' },
    { key: 'remote_control_lyric_layout', reason: 'a layout of the remote window on this screen' },
    // 主进程持有的桌面设置。These are the main process's own values: on launch it sends them and
    // setDesktopPreferenceSnapshot writes them over localStorage (stores/useDesktopSettingsStore.ts),
    // so a value written by an import is replaced before the reload that was meant to apply it.
    // Writing them would mean going through the store setters or IPC, which is a follow-up PR.
    { key: 'close_to_tray', reason: 'held by the main process; the launch snapshot overwrites an imported value' },
    { key: 'minimize_to_tray', reason: 'held by the main process; the launch snapshot overwrites an imported value' },
    { key: 'hide_taskbar_icon', reason: 'held by the main process; the launch snapshot overwrites an imported value' },
    { key: 'prevent_display_sleep_during_playback', reason: 'held by the main process; the launch snapshot overwrites an imported value' },
    { key: 'voice_input_pause_enabled', reason: 'held by the main process; the launch snapshot overwrites an imported value' },
    { key: 'background_throttling', reason: 'held by the main process; the launch snapshot overwrites an imported value' },
    { key: 'wallpaper_mac_autohide_dock', reason: 'held by the main process; the launch snapshot overwrites an imported value' },
    { key: 'remote_control_skip_taskbar', reason: 'held by the main process; the launch snapshot overwrites an imported value' },
    { key: 'remote_control_hide_titlebar', reason: 'held by the main process; the launch snapshot overwrites an imported value' },
    { key: 'remote_control_click_through', reason: 'held by the main process; the launch snapshot overwrites an imported value' },
    { key: 'remote_control_expand_cover', reason: 'held by the main process; the launch snapshot overwrites an imported value' },
    { key: 'remote_control_text_shade', reason: 'held by the main process; the launch snapshot overwrites an imported value' },
    // A preference (auto / high-performance / low-power), not a GPU name — another machine's cards
    // only make it fall back. Excluded for the same snapshot reason as the switches above.
    { key: 'gpu_preference', reason: 'held by the main process; the launch snapshot overwrites an imported value' },
    // Also the only switch on a confirmation: writing it straight would put a machine into wallpaper
    // mode without the first-entry prompt (review of #1041).
    { key: 'wallpaper_mode', reason: 'held by the main process, and it must not skip the first-entry confirmation' },
    // Turning the mod system on from a file would install and load someone else's mods unasked.
    { key: 'mod_system_enabled', reason: 'held by the main process; loading it would enable and load another machine\u2019s mods' },
];

/**
 * Keys the visual config code already carries, so this bundle leaves them alone.
 *
 * Two documents can take settings to another machine: the shortcode (utils/appearanceCodec.ts, also
 * what the web build's OBS quick import reads) and this bundle. A key in both would be written by
 * whichever was imported last, so the rule is strict: a key the shortcode carries is not carried
 * here, and a key it does not carry (an option the OBS page cannot show) is carried here.
 *
 * The shortcode's field table decides which is which, key by key, in
 * dev/dedicatus/appearanceDestinations.mjs (D511). That table is the authority; this list is its
 * projection onto the settings this bundle would otherwise carry, and
 * settingsCatalogCoverage.test.ts fails when the two disagree, so a change there cannot silently
 * leave this list behind.
 */
const CARRIED_BY_VISUAL_CONFIG = 'carried by the visual config code; see dev/dedicatus/appearanceDestinations.mjs';

export const SETTINGS_VISUAL_CONFIG_KEYS: ExcludedSettingsEntry[] = [
    { key: 'background_opacity', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'disable_visualizer_geometric_background', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'disable_visualizer_vignette', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'follow_system_theme', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'harmony_subtitle_background', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'hide_player_translation_subtitle', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'lattice_badge_current_only', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'library_wall_backdrop_blur', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'library_wall_backdrop_lyrics', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'library_wall_seam_clear', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'library_wall_seam_direction', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'library_wall_seam_style', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'library_wall_stack_edges', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'lyric_render_quality', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'lyrics_custom_font', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'lyrics_font_fallback_families', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'lyrics_font_scale', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'lyrics_font_style', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'lyrics_font_weight', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'player_header_blur', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'random_visualizer_mode_per_song', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'random_visualizer_modes', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'scratchpad_handle_style', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'show_harmony_subtitle', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'show_subtitle_translation', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'stage_track_pill_in_obs', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'stage_track_pill_mode', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'stage_track_pill_on_home', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'stage_track_pill_position', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'stage_track_pill_timeout_sec', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'static_mode', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'subtitle_content_mode', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'subtitle_font_fallback_families', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'subtitle_font_family', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'subtitle_font_inherits_lyrics', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'subtitle_font_scale', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'subtitle_font_style', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'subtitle_font_weight', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'subtitle_overlay_background', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'subtitle_overlay_layout', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'subtitle_overlay_opacity', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'subtitle_upcoming_lyrics_blur', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'use_cover_color_bg', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'visualizer_background_mode', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'visualizer_mode', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'visualizer_opacity', reason: CARRIED_BY_VISUAL_CONFIG },
    { key: 'visualizer_smart_beat', reason: CARRIED_BY_VISUAL_CONFIG },
];

const CATALOG_BY_KEY = new Map(SETTINGS_CATALOG.map(item => [item.key, item]));

export const settingsCatalogEntry = (key: string): SettingsCatalogEntry | undefined => CATALOG_BY_KEY.get(key);

export const settingsCatalogKeys = (): string[] => SETTINGS_CATALOG.map(item => item.key);

/** The catalog's entries of one group, in catalog order. */
export const settingsCatalogGroup = (group: SettingsGroupId): SettingsCatalogEntry[] => (
    SETTINGS_CATALOG.filter(item => item.group === group)
);

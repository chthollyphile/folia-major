// shared/controlCatalog.mjs
// The single source of truth for the Folia Control API: every tool the in-app bridge,
// the Electron control server, the CLI and the MCP server can expose.
//
// This file is plain ESM with no dependency so that three runtimes can read it unchanged:
//   * the renderer (Vite, through src/control/*)  -> executes bridge tools
//   * the Electron main process (through /tools)  -> main-executor tools + MCP HTTP
//   * the Node CLI / MCP stdio server (control/)  -> tool descriptions and schemas
//
// Adding a tool is a two-step change: add its definition here, then add the handler in
// src/control/handlers/ and re-run the catalog consistency test.
//
// `executor`:
//   'bridge'  - runs in the renderer through window.__FOLIA_CONTROL__.invoke()
//   'main'    - runs in the Electron main process (screenshot, quit)

export const CONTROL_API_VERSION = 1;

/** Event types the bridge records in its ring buffer, in the order they are declared. */
export const CONTROL_EVENT_TYPES = [
    'playback.songChanged',
    'playback.stateChanged',
    'playback.queueChanged',
    'playback.volumeChanged',
    'playback.loopModeChanged',
    'visualizer.modeChanged',
    'visualizer.backgroundChanged',
    'theme.changed',
    'view.changed',
    'palette.executed',
];

export const CONTROL_ERROR_CODES = {
    bad_request: 'The arguments did not match the tool schema.',
    unknown_tool: 'No tool with that name is declared in the control catalog.',
    unavailable: 'The tool exists but the app state does not allow it right now.',
    not_ready: 'The renderer bridge is not installed yet (the page is still loading).',
    no_song: 'No song is current or the requested song could not be resolved.',
    no_results: 'The search returned no results.',
    search_failed: 'The online provider refused or failed the search.',
    playback_failed: 'The provider/app refused to start playback.',
    unsupported: 'This build or platform does not support the requested action.',
    disabled: 'The action is disabled by the control server configuration.',
    timeout: 'The action did not finish in time.',
    internal: 'Unexpected failure inside the app.',
};

/**
 * @typedef {{
 *   name: string,
 *   title: string,
 *   group: string,
 *   executor: 'bridge' | 'main',
 *   summary: string,
 *   description: string,
 *   readOnly?: boolean,
 *   destructive?: boolean,
 *   inputSchema: { type: 'object', properties?: Record<string, unknown>, required?: string[], additionalProperties?: boolean },
 * }} ControlTool
 */

const obj = (properties = {}, required = [], extra = {}) => ({
    type: 'object',
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
    ...extra,
});

const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const num = (description, extra = {}) => ({ type: 'number', description, ...extra });
const int = (description, extra = {}) => ({ type: 'integer', description, ...extra });
const bool = (description) => ({ type: 'boolean', description });

/** @type {ControlTool[]} */
export const CONTROL_TOOLS = [
    // ------------------------------------------------------------------------------------
    // Introspection
    // ------------------------------------------------------------------------------------
    {
        name: 'folia_status',
        title: 'Folia status',
        group: 'system',
        executor: 'bridge',
        readOnly: true,
        summary: 'One call summary of the app: version, window, provider, now playing, volume, view.',
        description:
            'Returns a compact status object. Use this first when you connect, to learn which provider is active, '
            + 'whether a song is playing and where the user is. For the full picture use folia_state.',
        inputSchema: obj(),
    },
    {
        name: 'folia_state',
        title: 'Folia state snapshot',
        group: 'system',
        executor: 'bridge',
        readOnly: true,
        summary: 'Full readable snapshot: playback, queue, volume, visualizer, theme, providers, settings.',
        description:
            'Returns the whole control-readable state of the app. Sections are included by default except lyrics lines. '
            + 'Prefer this over reading individual settings stores when you need to understand the current situation.',
        inputSchema: obj({
            includeQueue: bool('Include the play queue (default true, max 100 entries).'),
            includeLyrics: bool('Include the current lyric lines (default false).'),
            includeProviders: bool('Include online provider account summaries (default true).'),
        }),
    },
    {
        name: 'folia_tools',
        title: 'List Folia control tools',
        group: 'system',
        executor: 'bridge',
        readOnly: true,
        summary: 'List every control tool, grouped, with its executor and danger flags.',
        description:
            'Returns tool metadata. MCP clients already get this through tools/list; this tool is for agents that '
            + 'drive Folia through the CLI or a raw HTTP call.',
        inputSchema: obj({
            group: str('Only return tools of this group (e.g. playback, visualizer, settings).'),
        }),
    },
    // ------------------------------------------------------------------------------------
    // Command palette passthrough (covers the remaining ~125 app actions)
    // ------------------------------------------------------------------------------------
    {
        name: 'folia_palette_list',
        title: 'List command palette commands',
        group: 'palette',
        executor: 'bridge',
        readOnly: true,
        summary: 'All in-app commands (id, group, title, availability). The universal capability index.',
        description:
            'Lists the command palette registry. Each entry is an app action; run one with folia_palette_run using '
            + 'its id. This is the widest capability surface Folia has: transport, queue, visualizer styles, '
            + 'backgrounds, themes, panels, navigation, mods, sleep timer, lyric export and so on.',
        inputSchema: obj({
            query: str('Filter by title, id or keywords (case-insensitive).'),
            includeUnavailable: bool('Include commands that are currently unavailable (default false).'),
            includeHidden: bool('Include hidden mode-carrier commands (default false).'),
        }),
    },
    {
        name: 'folia_palette_run',
        title: 'Run a command palette command',
        group: 'palette',
        executor: 'bridge',
        summary: 'Execute any app command by id, optionally with input (e.g. volume "35", search "周杰伦").',
        description:
            'Runs the command as if the user had picked it in the command palette, including commands that normally '
            + 'open an inline surface. Pass the command input as the second argument (volume accepts 0-100, search '
            + 'commands accept the query). Example: {"id":"playback-volume","input":"35"}.',
        inputSchema: obj({
            id: str('Command id from folia_palette_list, e.g. "playback-next", "visualizer-picker".'),
            input: str('Optional command input; most commands ignore it.'),
        }, ['id']),
    },

    // ------------------------------------------------------------------------------------
    // Search / play
    // ------------------------------------------------------------------------------------
    {
        name: 'folia_search',
        title: 'Search songs',
        group: 'search',
        executor: 'bridge',
        readOnly: true,
        summary: 'Search the active online provider and/or the local library; returns playable song objects.',
        description:
            'Searches the active online provider (default), a named provider, the local library, or all of them, and '
            + 'returns normalised results. Each result carries `index` and is directly usable as the `song` argument of '
            + 'folia_play / folia_queue_add. Provider ids come from folia_providers (e.g. qishui, netease, kugou, qq, '
            + 'bodian, ytm, spotify). Search needs no login for most providers, but playback of account-restricted '
            + 'songs does. recordingVersion is currently unknown: normalized provider metadata does not verify '
            + 'original/cover status. Never infer that status from song or artist names.',
        inputSchema: obj({
            query: str('Search text (song title, artist, album).'),
            source: str('"active" (default), "local", "all", or an online provider id.', {
                enum: ['active', 'local', 'all', 'qishui', 'netease', 'kugou', 'qq', 'bodian', 'ytm', 'spotify', 'navidrome'],
            }),
            provider: str('Explicit provider id; wins over source when both are given.'),
            limit: int('How many results to return (1-50, default 10).', { minimum: 1, maximum: 50 }),
            offset: int('Pagination offset (default 0).', { minimum: 0 }),
        }, ['query']),
    },
    {
        name: 'folia_play_search',
        title: 'Search and play',
        group: 'playback',
        executor: 'bridge',
        summary: 'Convenience: search for a query and immediately play the result at `index` (default 0).',
        description:
            'Searches then plays in one call. Use folia_search first when you need to choose among results, or when '
            + 'the query might match several artists.',
        inputSchema: obj({
            query: str('Search text.'),
            index: int('Which result to play (0-based, default 0).', { minimum: 0 }),
            provider: str('Explicit provider id (default: active provider).'),
            source: str('"active" (default), "local" or "all".', { enum: ['active', 'local', 'all'] }),
            view: str('Where to land after the song starts: "player" (default, the lyric visualizer), "lattice" (the wall), or "stay" (do not navigate). The user\'s own "open which view on play" setting does not apply to control calls.', { enum: ['player', 'lattice', 'stay'] }),
        }, ['query']),
    },
    {
        name: 'folia_play',
        title: 'Play a song',
        group: 'playback',
        executor: 'bridge',
        summary: 'Play a song object from folia_search, a provider+id pair, or a local library id.',
        description:
            'Starts playing a concrete track. The song argument is usually a result object returned by folia_search. '
            + 'Alternatively pass `query` to search and play, a `localId` from folia_library, or `provider` + `id`. '
            + 'Playback of online songs uses the same pipeline as clicking a search result, including queue, lyrics '
            + 'and theme updates.',
        inputSchema: obj({
            song: { type: 'object', description: 'A song object returned by folia_search (preferred).' },
            localId: str('Local library song id (from folia_library).'),
            query: str('Search text; the first (or `index`) result is played.'),
            provider: str('Provider id when resolving by query or id.'),
            id: str('Provider-specific song id when resolving without a full song object.'),
            index: int('Result index used with `query` (default 0).', { minimum: 0 }),
            queue: bool('Replace the existing queue with the search results (default false: play the single song).'),
            view: str('Where to land after the song starts: "player" (default, the lyric visualizer), "lattice" (the wall), or "stay" (do not navigate). The user\'s own "open which view on play" setting does not apply to control calls.', { enum: ['player', 'lattice', 'stay'] }),
        }),
    },
    {
        name: 'folia_transport',
        title: 'Transport control',
        group: 'playback',
        executor: 'bridge',
        summary: 'play / pause / toggle / next / prev / stop.',
        description:
            'Controls the transport. `play` resumes a paused track (it does not start a new search), `next`/`prev` '
            + 'move the queue, `stop` pauses and clears the current track if the app supports it.',
        inputSchema: obj({
            action: str('Transport action.', { enum: ['play', 'pause', 'toggle', 'next', 'prev', 'stop'] }),
        }, ['action']),
    },
    {
        name: 'folia_seek',
        title: 'Seek',
        group: 'playback',
        executor: 'bridge',
        summary: 'Seek within the current track by absolute seconds or by percentage.',
        description:
            'Seeks the current track. Pass either `seconds` (absolute position) or `percent` (0-100 of duration). '
            + 'A seek resumes playback, like the progress bar does.',
        inputSchema: obj({
            seconds: num('Absolute position in seconds.', { minimum: 0 }),
            percent: num('Position as a percentage of duration (0-100).', { minimum: 0, maximum: 100 }),
        }),
    },
    {
        name: 'folia_volume',
        title: 'Volume and mute',
        group: 'playback',
        executor: 'bridge',
        summary: 'Read or set playback volume (0-100) / mute. No args returns the current value.',
        description:
            'Sets the media volume with the same setter the volume slider uses. `level` is 0-100, `delta` is added '
            + 'to the current level, and `mute` sets the mute switch (true/false). With no argument it returns '
            + '`{ level, muted }`.',
        inputSchema: obj({
            level: num('Absolute volume 0-100.', { minimum: 0, maximum: 100 }),
            delta: num('Relative volume change (-100..100).'),
            mute: bool('Set the mute switch.'),
            status: bool('Return the current volume/mute without changing it.'),
        }),
    },
    {
        name: 'folia_loop',
        title: 'Repeat mode',
        group: 'playback',
        executor: 'bridge',
        summary: 'Get/set the repeat mode (off/all/one), or cycle it like the repeat button.',
        description:
            'Sets the repeat mode with the same setter the UI uses. Omit `mode` and set `cycle` to rotate '
            + 'off -> all -> one -> off.',
        inputSchema: obj({
            mode: str('Repeat mode.', { enum: ['off', 'all', 'one'] }),
            cycle: bool('Cycle to the next repeat mode.'),
        }),
    },
    {
        name: 'folia_shuffle',
        title: 'Shuffle queue',
        group: 'playback',
        executor: 'bridge',
        summary: 'Shuffle the current play queue.',
        description: 'Shuffles the queue through the same action as the shuffle button.',
        inputSchema: obj(),
    },
    {
        name: 'folia_like',
        title: 'Like / unlike current song',
        group: 'playback',
        executor: 'bridge',
        summary: 'Toggle (or explicitly set) the like state of the current song.',
        description:
            'Likes or unlikes the current song through the provider account. Needs a signed-in account for providers '
            + 'that support likes; returns the resulting state.',
        inputSchema: obj({
            liked: bool('Explicit target state; omit to toggle.'),
        }),
    },
    {
        name: 'folia_sleep_timer',
        title: 'Sleep timer',
        group: 'playback',
        executor: 'bridge',
        summary: 'Set, cancel or read the sleep timer.',
        description:
            'Configures the sleep timer (hours + minutes) and arms it, or cancels it. With no argument returns the '
            + 'current configuration and remaining time.',
        inputSchema: obj({
            minutes: int('Minutes part (0-59).', { minimum: 0, maximum: 59 }),
            hours: int('Hours part (0-999).', { minimum: 0, maximum: 999 }),
            cancel: bool('Disarm the timer.'),
            status: bool('Return the current timer state without changing it.'),
        }),
    },
    {
        name: 'folia_replaygain',
        title: 'ReplayGain mode',
        group: 'playback',
        executor: 'bridge',
        summary: 'Set ReplayGain mode (off/track/album).',
        description: 'Sets the ReplayGain mode through the same path as the palette commands.',
        inputSchema: obj({
            mode: str('ReplayGain mode.', { enum: ['off', 'track', 'album'] }),
        }, ['mode']),
    },

    // ------------------------------------------------------------------------------------
    // Queue
    // ------------------------------------------------------------------------------------
    {
        name: 'folia_queue',
        title: 'Read the queue',
        group: 'queue',
        executor: 'bridge',
        readOnly: true,
        summary: 'List the play queue with indices, current index and FM mode.',
        description:
            'Returns a page of the play queue. Indices are stable at read time and are what folia_queue_play / '
            + 'folia_queue_remove / folia_queue_move take.',
        inputSchema: obj({
            offset: int('Start index (default 0).', { minimum: 0 }),
            limit: int('Page size 1-100 (default 50).', { minimum: 1, maximum: 100 }),
        }),
    },
    {
        name: 'folia_queue_play',
        title: 'Play a queue item',
        group: 'queue',
        executor: 'bridge',
        summary: 'Jump to the queue entry at `index`.',
        description: 'Plays a queue entry by index, keeping Personal FM semantics when FM is on.',
        inputSchema: obj({
            index: int('Queue index (0-based, from folia_queue).', { minimum: 0 }),
            view: str('Where to land after the song starts: "player" (default, the lyric visualizer), "lattice" (the wall), or "stay" (do not navigate). The user\'s own "open which view on play" setting does not apply to control calls.', { enum: ['player', 'lattice', 'stay'] }),
        }, ['index']),
    },
    {
        name: 'folia_queue_add',
        title: 'Add songs to the queue',
        group: 'queue',
        executor: 'bridge',
        summary: 'Append a song object / search query / local song to the play queue.',
        description:
            'Adds one or more tracks to the queue without starting playback. Resolve songs with folia_search and pass '
            + 'a result as `song`, or pass `query` to search-and-add. `position` "next" inserts after the current '
            + 'track; default "end".',
        inputSchema: obj({
            song: { type: 'object', description: 'A song object from folia_search.' },
            songs: { type: 'array', description: 'Several song objects from folia_search.', items: { type: 'object' } },
            query: str('Search text; the first (or `index`) result is added.'),
            provider: str('Provider id for query resolution.'),
            index: int('Result index used with `query` (default 0).', { minimum: 0 }),
            localId: str('Local library song id (from folia_library).'),
            position: str('Where to insert.', { enum: ['end', 'next'] }),
        }),
    },
    {
        name: 'folia_queue_remove',
        title: 'Remove queue entries',
        group: 'queue',
        executor: 'bridge',
        summary: 'Remove one or more entries from the queue by index.',
        description:
            'Removes queue entries. Removing the current entry lets the app advance exactly as the queue UI would.',
        inputSchema: obj({
            index: int('Single index to remove.', { minimum: 0 }),
            indices: { type: 'array', description: 'Several indices (removed highest-first).', items: { type: 'integer', minimum: 0 } },
        }),
    },
    {
        name: 'folia_queue_move',
        title: 'Move a queue entry',
        group: 'queue',
        executor: 'bridge',
        summary: 'Move an entry to another index, to "next", or to the end.',
        description: 'Reorders the queue using the same actions as the queue palette.',
        inputSchema: obj({
            from: int('Index to move.', { minimum: 0 }),
            to: int('Destination index.', { minimum: 0 }),
            toNext: bool('Move directly after the current track.'),
            toEnd: bool('Move to the end of the queue.'),
        }, ['from']),
    },
    {
        name: 'folia_queue_clear',
        title: 'Clear the queue',
        group: 'queue',
        executor: 'bridge',
        destructive: true,
        summary: 'Remove every song from the play queue.',
        description: 'Clears the queue (Personal FM queues are refused, like the UI).',
        inputSchema: obj(),
    },

    // ------------------------------------------------------------------------------------
    // Lyrics
    // ------------------------------------------------------------------------------------
    {
        name: 'folia_lyrics',
        title: 'Current lyrics',
        group: 'lyrics',
        executor: 'bridge',
        readOnly: true,
        summary: 'Current song lyrics: format, lines, current line index, offsets.',
        description:
            'Returns the lyric document the player is displaying. Set includeLines to get the timed lines; without it '
            + 'you only get metadata and the current line. The lines are the exact data the visualizer renders.',
        inputSchema: obj({
            includeLines: bool('Include timed lines (default false).'),
            limit: int('Max lines when includeLines is true (default 200, max 2000).', { minimum: 1, maximum: 2000 }),
        }),
    },
    {
        name: 'folia_lyric_offset',
        title: 'Lyric timeline offset',
        group: 'lyrics',
        executor: 'bridge',
        summary: 'Get/set the lyric timeline offset (per song or global).',
        description:
            'Adjusts lyric timing. `scope` "song" (default) changes the current track offset; "global" changes the '
            + 'setting used for all tracks. Pass `ms` for an absolute offset or `deltaMs` to nudge.',
        inputSchema: obj({
            ms: num('Absolute offset in milliseconds (-60000..60000).', { minimum: -60000, maximum: 60000 }),
            deltaMs: num('Relative offset change in milliseconds (-5000..5000).', { minimum: -5000, maximum: 5000 }),
            scope: str('Which offset to read/write.', { enum: ['song', 'global'] }),
        }),
    },
    {
        name: 'folia_lyric_seek',
        title: 'Seek to a lyric line',
        group: 'lyrics',
        executor: 'bridge',
        summary: 'Seek playback to a lyric line index (or to absolute seconds).',
        description:
            'Jumps to the start time of a lyric line from folia_lyrics (0-based). Useful for "play the chorus" style '
            + 'requests. Alternatively pass absolute seconds.',
        inputSchema: obj({
            lineIndex: int('Lyric line index (0-based).', { minimum: 0 }),
            seconds: num('Absolute playback seconds.', { minimum: 0 }),
        }),
    },

    // ------------------------------------------------------------------------------------
    // Visualizer / appearance
    // ------------------------------------------------------------------------------------
    {
        name: 'folia_visualizer_list',
        title: 'List lyric visualizers and backgrounds',
        group: 'visualizer',
        executor: 'bridge',
        readOnly: true,
        summary: 'All available lyric animation modes and background modes, with labels and order.',
        description:
            'Lists the live registries, so mod-contributed modes are included. Use the returned ids with '
            + 'folia_visualizer_set and folia_background_set.',
        inputSchema: obj(),
    },
    {
        name: 'folia_visualizer_set',
        title: 'Switch lyric visualizer',
        group: 'visualizer',
        executor: 'bridge',
        summary: 'Switch the full-screen lyric animation mode (e.g. fume, classic, monet, diorama).',
        description:
            'Sets the lyric animation mode the same way the style picker does, including the "random per song" flag '
            + 'remaining untouched. Use ids from folia_visualizer_list.',
        inputSchema: obj({
            mode: str('Visualizer mode id (e.g. "fume", "classic", "lumiere", "mod:<modId>:<id>").'),
        }, ['mode']),
    },
    {
        name: 'folia_background_set',
        title: 'Switch background mode',
        group: 'visualizer',
        executor: 'bridge',
        summary: 'Switch the background layout (common, latent, monet, nomand, sora, url).',
        description:
            'Sets the background mode. Some backgrounds have their own tuning (Monet layouts, Latent layers) which '
            + 'folia_visual_tuning adjusts.',
        inputSchema: obj({
            mode: str('Background mode id, from folia_visualizer_list.'),
        }, ['mode']),
    },
    {
        name: 'folia_visual_tuning',
        title: 'Tune background',
        group: 'visualizer',
        executor: 'bridge',
        summary: 'Patch Monet or Latent background tuning (layout, display mode, colors, ...).',
        description:
            'Merges a partial tuning object into the chosen background. Monet accepts backgroundLayout, '
            + 'half-overlay tuning and colors; Latent accepts displayMode ("both", "mesh", "dithering") and shader '
            + 'tuning. Unknown fields are forwarded to the store, so prefer fields the app itself exposes.',
        inputSchema: obj({
            target: str('Which background tuning to patch.', { enum: ['monet', 'latent'] }),
            patch: { type: 'object', description: 'Partial tuning object, e.g. {"backgroundLayout":"full-overlay"}.', additionalProperties: true },
        }, ['target', 'patch']),
    },
    {
        name: 'folia_smart_beat',
        title: 'Smart beat mode',
        group: 'visualizer',
        executor: 'bridge',
        summary: 'Toggle the beat-driven effects (beat_this analysis, Sonnet/Diorama/Pendolo FX).',
        description:
            'Turns the smart beat mode (the beat_this-driven effects shared by every visualizer and background) '
            + 'on or off. With no argument it returns the current enabled state and its sub-settings.',
        inputSchema: obj({
            enabled: bool('Target state; omit to read.'),
        }),
    },
    {
        name: 'folia_video_layer',
        title: 'Video layer',
        group: 'visualizer',
        executor: 'bridge',
        summary: 'Toggle the video layer behind the lyrics, or open the file picker.',
        description:
            'The app can play a muted local video behind the lyrics. Toggle it on/off, or ask the app to open the '
            + 'native file picker (this needs the user in front of the screen).',
        inputSchema: obj({
            enabled: bool('Target enabled state; omit to read.'),
            pickFile: bool('Open the native video file picker.'),
        }),
    },
    {
        name: 'folia_appearance',
        title: 'Appearance and theme',
        group: 'visualizer',
        executor: 'bridge',
        summary: 'Day/night, system-follow, cover-color background, static mode, AI theme generation.',
        description:
            'Reads or changes the app-level appearance switches, or triggers the same AI theme generation and theme '
            + 'quick editor the UI has. With no arguments it returns the current appearance state.',
        inputSchema: obj({
            daylight: bool('Day (true) or night (false) mode.'),
            followSystemTheme: bool('Follow the OS theme.'),
            coverColorBg: bool('Use the cover color as background.'),
            staticMode: bool('Static (non-animated) background.'),
            disableHomeDynamicBackground: bool('Disable the home dynamic background.'),
            generateAITheme: bool('Generate a theme from the current lyrics (needs configured AI credentials).'),
            openThemeEditor: bool('Open the theme quick editor.'),
        }),
    },

    // ------------------------------------------------------------------------------------
    // Settings
    // ------------------------------------------------------------------------------------
    {
        name: 'folia_settings_read',
        title: 'Read settings',
        group: 'settings',
        executor: 'bridge',
        readOnly: true,
        summary: 'Read curated app settings (audio, visualizer, theme, lyrics, sleep timer, playback...).',
        description:
            'Returns settings owned by the renderer stores (the ones that persist to localStorage), plus a redacted '
            + 'main-process settings snapshot. Use folia_settings_write for a whitelisted subset, and folia_palette_run '
            + 'for switches that only exist as commands.',
        inputSchema: obj({
            store: str('Only read one store: audio, visualizer, theme, lyrics, playback, sleepTimer, view, appearance, main.'),
            key: str('Only read one field of the chosen store.'),
        }),
    },
    {
        name: 'folia_settings_write',
        title: 'Write a setting',
        group: 'settings',
        executor: 'bridge',
        summary: 'Set a whitelisted setting by dotted path (e.g. audio.volume, theme.daylight).',
        description:
            'Writes one setting through its owning store action, so persistence and side effects match the UI. '
            + 'Supported paths: audio.volume, audio.muted, audio.loopMode, audio.audioQuality, audio.playbackFade, '
            + 'visualizer.mode, visualizer.background, visualizer.opacity, visualizer.randomPerSong, '
            + 'visualizer.glowBlurQuantize, theme.daylight, theme.followSystemTheme, theme.coverColorBg, '
            + 'theme.staticMode, theme.disableHomeDynamicBackground, lyrics.globalOffsetMs, lyrics.autoUseBest, '
            + 'playback.replayGainMode, sleepTimer.hours, sleepTimer.minutes. '
            + 'Everything else: use folia_palette_run.',
        inputSchema: obj({
            key: str('Dotted settings path, e.g. "audio.volume".'),
            value: { description: 'New value (number, boolean, string or null depending on the key).' },
        }, ['key', 'value']),
    },
    {
        name: 'folia_settings_open',
        title: 'Open settings dialog',
        group: 'settings',
        executor: 'bridge',
        summary: 'Open the settings dialog on a tab/subview.',
        description:
            'Opens Settings -> Options on a subview (appearance, player, home, playback, lyrics, interaction, '
            + 'integration, storage, desktop, graphics, mods, visualizer, themePark, lyricFilter, globalLyricOffset).',
        inputSchema: obj({
            tab: str('Dialog tab.', { enum: ['options', 'help'] }),
            subview: str('Options subview id.'),
            anchor: str('Optional settings anchor id to scroll to.'),
        }),
    },

    // ------------------------------------------------------------------------------------
    // Navigation / UI
    // ------------------------------------------------------------------------------------
    {
        name: 'folia_navigate',
        title: 'Navigate',
        group: 'navigation',
        executor: 'bridge',
        summary: 'Switch the main view: home, player, lattice (the library wall).',
        description: 'Navigates the app between the main views without touching playback.',
        inputSchema: obj({
            view: str('Target view.', { enum: ['home', 'player', 'lattice'] }),
        }, ['view']),
    },
    {
        name: 'folia_panel',
        title: 'Open/close a panel',
        group: 'navigation',
        executor: 'bridge',
        summary: 'Open or close the unified side panel and choose its tab.',
        description:
            'Controls the sliding panel: cover, controls (equalizer), queue, account, local, navi, onlineLyrics, '
            + 'lyrics. With `open` omitted the panel is opened.',
        inputSchema: obj({
            tab: str('Panel tab.', { enum: ['cover', 'controls', 'queue', 'account', 'local', 'navi', 'onlineLyrics', 'lyrics'] }),
            open: bool('true opens, false closes; omit to open.'),
        }),
    },
    // ------------------------------------------------------------------------------------
    // Library
    // ------------------------------------------------------------------------------------
    {
        name: 'folia_library',
        title: 'Local library',
        group: 'library',
        executor: 'bridge',
        summary: 'List / search / play local library songs.',
        description:
            'Reads the local library the app has imported (not the provider library). `list` returns a page, '
            + '`search` filters by title/artist/album, `play` plays a local song by id.',
        inputSchema: obj({
            action: str('Library action.', { enum: ['list', 'search', 'play'] }),
            query: str('Filter text for action=search.'),
            id: str('Local song id for action=play.'),
            offset: int('Pagination offset (default 0).', { minimum: 0 }),
            limit: int('Page size 1-100 (default 20).', { minimum: 1, maximum: 100 }),
        }, ['action']),
    },
    {
        name: 'folia_providers',
        title: 'Online providers',
        group: 'library',
        executor: 'bridge',
        readOnly: true,
        summary: 'List online providers, capability summary and login state.',
        description:
            'Returns every registered online music provider with its display name, capabilities and account/login '
            + 'state. Use it to choose the provider argument for folia_search.',
        inputSchema: obj(),
    },

    // ------------------------------------------------------------------------------------
    // Window / system
    // ------------------------------------------------------------------------------------
    {
        name: 'folia_window',
        title: 'Window controls',
        group: 'window',
        executor: 'bridge',
        summary: 'Read window state or minimize/maximize/fullscreen/always-on-top/click-through/close.',
        description:
            'Window-level actions for the Electron main window. `status` returns maximized/fullscreen/always-on-top/'
            + 'click-through. `close` hides to tray or closes exactly like the window close button.',
        inputSchema: obj({
            action: str('Window action.', {
                enum: ['status', 'minimize', 'maximize', 'fullscreen', 'alwaysOnTop', 'clickThrough', 'close'],
            }),
            value: bool('Target value for alwaysOnTop / clickThrough; omit to toggle.'),
        }, ['action']),
    },
    {
        name: 'folia_screenshot',
        title: 'Screenshot the app',
        group: 'window',
        executor: 'main',
        readOnly: true,
        summary: 'Capture the main window as PNG (base64 + optional file on disk).',
        description:
            'Captures the current main window (works even while the UI animates). Returns base64 PNG and dimensions; '
            + 'set save=true (default on for the CLI) to also write it under the control data directory.',
        inputSchema: obj({
            save: bool('Write the PNG to disk under the control data directory (default true).'),
            path: str('Explicit absolute file path to write.'),
        }),
    },
    {
        name: 'folia_quit',
        title: 'Quit Folia',
        group: 'window',
        executor: 'main',
        destructive: true,
        summary: 'Quit the application (requires confirm=true).',
        description:
            'Quits Folia. Destructive: keep it for the end of an automation session, and always ask the user first '
            + 'unless they explicitly asked to close the app.',
        inputSchema: obj({
            confirm: bool('Must be true to actually quit.'),
        }, ['confirm']),
    },

    // ------------------------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------------------------
    {
        name: 'folia_events',
        title: 'Control events',
        group: 'events',
        executor: 'bridge',
        readOnly: true,
        summary: 'Poll the event stream (song/state/queue/volume/visualizer/theme/view changes).',
        description:
            'Returns control events recorded by the bridge since a cursor. Call it repeatedly with the returned '
            + '`cursor` to follow the app. `waitMs` long-polls up to 10s for new events, which makes it usable as a '
            + 'watch loop. Event types are listed in the docs.',
        inputSchema: obj({
            since: int('Last cursor you saw (omit for the current end of the buffer).', { minimum: 0 }),
            limit: int('Max events to return (1-200, default 50).', { minimum: 1, maximum: 200 }),
            waitMs: int('Long-poll wait for new events, 0-10000 ms (default 0).', { minimum: 0, maximum: 10000 }),
        }),
    },
];

/** @type {ReadonlySet<string>} */
export const CONTROL_TOOL_NAMES = new Set(CONTROL_TOOLS.map(tool => tool.name));

/** Tools executed by the Electron main process instead of the renderer bridge. */
export const CONTROL_MAIN_TOOL_NAMES = new Set(
    CONTROL_TOOLS.filter(tool => tool.executor === 'main').map(tool => tool.name),
);

/** Tools only exposed when the server/CLI runs with eval enabled. */
export const CONTROL_DANGEROUS_TOOL_NAMES = new Set(
    CONTROL_TOOLS.filter(tool => tool.destructive).map(tool => tool.name),
);

export const getControlTool = (name) => CONTROL_TOOLS.find(tool => tool.name === name) ?? null;

export const CONTROL_GROUPS = [...new Set(CONTROL_TOOLS.map(tool => tool.group))];

/** The JSON-RPC protocol version the embedded MCP endpoint speaks. */
export const CONTROL_MCP_PROTOCOL_VERSION = '2025-06-18';
export const CONTROL_SERVER_NAME = 'folia-control';
export const CONTROL_SERVER_VERSION = '1.0.0';

/** Default local control server port. Keep in sync with electron/controlServer.cjs. */
export const DEFAULT_CONTROL_PORT = 4567;

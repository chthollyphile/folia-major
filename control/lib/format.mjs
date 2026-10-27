// control/lib/format.mjs
// Human readable rendering for CLI output: tables, state summaries, event lines and the
// actionable error text every failure path ends with. `--json` bypasses all of this.

const NO_HINT = '';

const ERROR_HINTS = {
    bad_request: 'the arguments did not match the tool schema; check "folia tools" or the tool docs',
    unknown_tool: 'the CLI catalog and the running app build differ; use both from the same checkout',
    unavailable: 'the app state does not allow this action right now',
    not_ready: 'the app renderer is still loading; retry in a moment (or wait for "folia status" to answer)',
    no_song: 'start playback first: folia play <query>',
    no_results: 'try another query, or pass --provider <id> (see folia providers)',
    search_failed: 'the provider refused the search; check the provider account/login state with folia providers',
    playback_failed: 'the provider or app refused playback; the song may require a signed-in account',
    unsupported: 'this build or platform does not support the action',
    disabled: 'start the app with FOLIA_CONTROL_ALLOW_EVAL=1 and the CLI with --allow-eval',
    timeout: 'raise --timeout (ms); long operations can take longer than the default 30s',
    internal: 'unexpected failure inside the app; check the app developer log for the stack',
    unauthorized: 'pass --token <t> or --token-file <path>; the token lives in <userData>/control-token',
    connection_failed: 'start the app with FOLIA_CONTROL=1 (dev: ELECTRON_DEV=true), or pass --url / --transport cdp',
    cdp_unavailable: 'start the app with --remote-debugging-port=9222 and pass --cdp <url>',
    cdp_no_target: 'pass --target <url-substring> to pick the right page target',
};

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

function codePointWidth(char) {
    const code = char.codePointAt(0);
    if (code < 32) {
        return 0;
    }
    if (
        code >= 0x1100
        && (code <= 0x115f
            || code === 0x2329
            || code === 0x232a
            || (code >= 0x2e80 && code <= 0xa4cf)
            || (code >= 0xac00 && code <= 0xd7a3)
            || (code >= 0xf900 && code <= 0xfaff)
            || (code >= 0xfe10 && code <= 0xfe19)
            || (code >= 0xfe30 && code <= 0xfe6f)
            || (code >= 0xff00 && code <= 0xff60)
            || (code >= 0xffe0 && code <= 0xffe6))
    ) {
        return 2;
    }
    return 1;
}

/** Terminal column width of a string, counting CJK characters as two columns. */
export function stringWidth(text) {
    let width = 0;
    for (const char of String(text ?? '')) {
        width += codePointWidth(char);
    }
    return width;
}

function truncateCell(text, width) {
    const value = String(text ?? '');
    if (stringWidth(value) <= width) {
        return value;
    }
    let result = '';
    let used = 0;
    for (const char of value) {
        const next = codePointWidth(char);
        if (used + next > width - 1) {
            break;
        }
        result += char;
        used += next;
    }
    return `${result}…`;
}

function padCell(text, width) {
    return `${text}${' '.repeat(Math.max(0, width - stringWidth(text)))}`;
}

/** Render rows as an aligned plain text table (no ANSI, safe to pipe). */
export function renderTable(headers, rows, { maxWidth = 48 } = {}) {
    const cells = rows.map(row => row.map(cell => (cell === null || cell === undefined ? '' : String(cell))));
    const widths = headers.map((header, column) => {
        const values = [String(header), ...cells.map(row => row[column] ?? '')];
        return Math.min(maxWidth, Math.max(...values.map(stringWidth)));
    });
    const formatRow = row => row
        .map((cell, column) => padCell(truncateCell(cell ?? '', widths[column]), widths[column]))
        .join('  ')
        .trimEnd();
    return [formatRow(headers), ...cells.map(formatRow)].join('\n');
}

/** One line, compact rendering of an arbitrary value (used inside summaries). */
export function compact(value) {
    if (value === null || value === undefined) {
        return '';
    }
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function songLine(song) {
    if (!song || typeof song !== 'object') {
        return '(unknown song)';
    }
    const artist = song.artist
        ?? song.artistName
        ?? (Array.isArray(song.artists) ? song.artists.join(' / ') : null)
        ?? '?';
    return `${song.title ?? song.name ?? '(untitled)'} — ${artist}`;
}

/** `ms` -> `m:ss` / `h:mm:ss`; anything unknown becomes `--:--`. */
export function formatDuration(ms) {
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) {
        return '--:--';
    }
    const totalSeconds = Math.round(ms / 1000);
    return formatSeconds(totalSeconds);
}

/** `seconds` -> `m:ss` / `h:mm:ss`. */
export function formatSeconds(seconds) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
        return '--:--';
    }
    const total = Math.round(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const rest = total % 60;
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
    }
    return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function formatClock(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
        return '--:--:--';
    }
    return [date.getHours(), date.getMinutes(), date.getSeconds()]
        .map(part => String(part).padStart(2, '0'))
        .join(':');
}

function onOff(value) {
    return value ? 'on' : 'off';
}

function volumePercent(volume) {
    if (!volume || typeof volume !== 'object') {
        return '?';
    }
    if (typeof volume.percent === 'number') {
        return String(Math.round(volume.percent));
    }
    if (typeof volume.level === 'number') {
        return String(Math.round(volume.level * 100));
    }
    return '?';
}

/** Pull the first array out of an envelope-ish data object, tolerating several key names. */
export function extractList(data, keys) {
    if (Array.isArray(data)) {
        return data;
    }
    if (data && typeof data === 'object') {
        for (const key of [...keys, 'data']) {
            if (Array.isArray(data[key])) {
                return data[key];
            }
        }
    }
    return null;
}

// ---------------------------------------------------------------------------------------------
// Per-tool renderers
// ---------------------------------------------------------------------------------------------

/** `folia_search` / `folia_library` results table. */
export function formatSearchResults(data) {
    const results = extractList(data, ['results', 'songs', 'items', 'tracks']) ?? [];
    const query = data && typeof data === 'object' ? data.query : null;
    const provider = data && typeof data === 'object' ? (data.provider ?? data.providerId) : null;
    const headingParts = [`results: ${results.length}`];
    if (query) {
        headingParts.push(`for "${query}"`);
    }
    if (provider) {
        headingParts.push(`on ${provider}`);
    }
    if (results.length === 0) {
        return `${headingParts.join(' ')}\nno results — try another query or pass --provider <id>`;
    }
    const rows = results.map((song, position) => [
        song?.index ?? position,
        song?.title ?? song?.name ?? '(untitled)',
        song?.artist ?? (Array.isArray(song?.artists) ? song.artists.join(' / ') : ''),
        song?.album ?? '',
        formatDuration(song?.durationMs ?? song?.duration),
        song?.providerId ?? song?.provider ?? song?.source ?? '',
        'unknown',
    ]);
    return `${headingParts.join(' ')}\n${renderTable(['#', 'TITLE', 'ARTIST', 'ALBUM', 'TIME', 'PROVIDER', 'VERSION'], rows)}\nVERSION unknown: original/cover metadata is not supplied by the provider contract; do not infer it from names.`;
}

/** `folia_queue` table with a marker for the current entry. */
export function formatQueue(data) {
    const items = extractList(data, ['items', 'queue']) ?? [];
    const current = data && typeof data === 'object'
        ? (data.currentQueueIndex ?? data.currentIndex ?? -1)
        : -1;
    const total = data && typeof data === 'object' ? (data.total ?? items.length) : items.length;
    const heading = [`queue: ${total} song(s)`];
    if (data && typeof data === 'object' && data.isFmMode) {
        heading.push('FM mode');
    }
    if (current >= 0) {
        heading.push(`current #${current}`);
    }
    if (items.length === 0) {
        return `${heading.join(' · ')}\nqueue is empty — add songs with folia queue add <query>`;
    }
    const rows = items.map((entry, position) => {
        const song = entry?.song ?? entry;
        const index = entry?.index ?? position;
        return [
            index === current ? '>' : ' ',
            index,
            song?.title ?? song?.name ?? '(untitled)',
            song?.artist ?? (Array.isArray(song?.artists) ? song.artists.join(' / ') : ''),
            formatDuration(song?.durationMs ?? song?.duration),
        ];
    });
    return `${heading.join(' · ')}\n${renderTable(['', '#', 'TITLE', 'ARTIST', 'TIME'], rows)}`;
}

/** `folia_events` batch: cursor plus one line per event. */
export function formatEventLines(data) {
    const events = extractList(data, ['events']) ?? [];
    const cursor = data && typeof data === 'object' ? data.cursor : null;
    const lines = [`cursor ${cursor ?? '?'} · ${events.length} event(s)`];
    for (const event of events) {
        const payload = event?.data && Object.keys(event.data).length > 0 ? ` ${compact(event.data)}` : '';
        lines.push(`#${event?.seq ?? '?'} ${formatClock(event?.ts)} ${event?.type ?? '?'}${payload}`);
    }
    return lines.join('\n');
}

/** `folia_status`: compact, one screen. */
export function formatStatus(data) {
    if (!data || typeof data !== 'object') {
        return compact(data);
    }
    const app = data.app ?? {};
    const playback = data.playback ?? {};
    const view = data.view ?? {};
    const volume = data.volume ?? {};
    const lines = [`Folia ${app.version ?? '?'} · ${app.platform ?? process.platform}`];
    if (data.playback || data.view || data.volume) {
        lines.push(`playback: ${playback.state ?? 'idle'}${playback.song ? ` · ${songLine(playback.song)}` : ' · no song'}`);
        if (volume.percent !== undefined || volume.level !== undefined) {
            lines.push(`volume: ${volumePercent(volume)}%${volume.muted ? ' (muted)' : ''}`);
        }
        if (view.view) {
            const panel = view.panelOpen ? ` · panel ${view.panelTab ?? 'open'}` : '';
            lines.push(`view: ${view.view}${panel}`);
        }
    }
    const handled = new Set(['app', 'playback', 'volume', 'view', 'controlApiVersion', 'durationMs', 'ts']);
    for (const [key, value] of Object.entries(data)) {
        if (handled.has(key) || value === null || value === undefined) {
            continue;
        }
        lines.push(`${key}: ${compact(value)}`);
    }
    return lines.join('\n');
}

/** `folia_state`: the PROTOCOL §2.2 snapshot as sections. */
export function formatStateSnapshot(data) {
    if (!data || typeof data !== 'object') {
        return compact(data);
    }
    const app = data.app ?? {};
    const view = data.view ?? {};
    const playback = data.playback ?? {};
    const volume = data.volume ?? {};
    const visualizer = data.visualizer ?? {};
    const theme = data.theme ?? {};
    const lyrics = data.lyrics ?? {};
    const lines = [];

    lines.push(`Folia ${app.version ?? '?'} · ${app.platform ?? process.platform} · control v${app.controlVersion ?? data.controlApiVersion ?? '?'}`);
    const viewParts = [view.view ?? '?'];
    if (view.panelOpen) {
        viewParts.push(`panel ${view.panelTab ?? 'open'}`);
    }
    if (view.settingsOpen) {
        viewParts.push('settings open');
    }
    if (view.paletteOpen) {
        viewParts.push('palette open');
    }
    lines.push(`view: ${viewParts.join(' · ')}`);

    if (playback.song) {
        const queue = typeof playback.currentQueueIndex === 'number' && playback.currentQueueIndex >= 0
            ? ` · queue #${playback.currentQueueIndex}`
            : '';
        const liked = playback.liked === true ? ' · liked' : '';
        const fm = playback.isFmMode ? ' · FM' : '';
        lines.push(
            `playback: ${playback.state ?? 'idle'} · ${songLine(playback.song)} · `
            + `${formatSeconds(playback.positionSeconds)} / ${formatSeconds(playback.durationSeconds)}${queue}${liked}${fm}`,
        );
    } else {
        lines.push(`playback: ${playback.state ?? 'idle'} · no song`);
    }
    lines.push(`volume: ${volumePercent(volume)}%${volume.muted ? ' (muted)' : ''} · loop ${volume.loopMode ?? '?'}`);

    const visualParts = [
        `visualizer ${visualizer.mode ?? '?'}`,
        `background ${visualizer.background ?? 'none'}`,
        `smart beat ${onOff(visualizer.smartBeatEnabled)}`,
    ];
    if (visualizer.frameRate !== undefined) {
        visualParts.push(`fps ${compact(visualizer.frameRate)}`);
    }
    lines.push(`visual: ${visualParts.join(' · ')}`);

    const themeParts = [theme.daylight ? 'day' : 'night'];
    if (theme.followSystemTheme) {
        themeParts.push('follow system');
    }
    if (theme.coverColorBg) {
        themeParts.push('cover color');
    }
    if (theme.staticMode) {
        themeParts.push('static');
    }
    lines.push(`theme: ${themeParts.join(' · ')}`);

    if (lyrics.available !== undefined) {
        if (lyrics.available) {
            lines.push(
                `lyrics: ${lyrics.format ?? 'lyrics'} · ${lyrics.lineCount ?? 0} lines · current #${lyrics.currentLineIndex ?? -1}`
                + ` · offset ${lyrics.offsetMs ?? 0}ms (global ${lyrics.globalOffsetMs ?? 0}ms)`,
            );
        } else {
            lines.push('lyrics: none for the current song');
        }
    }
    if (Array.isArray(data.providers) && data.providers.length > 0) {
        lines.push(`providers: ${data.providers.map(provider => `${provider.id ?? provider.displayName ?? '?'} (${provider.status ?? '?'})`).join(' · ')}`);
    }
    if (data.queue && Array.isArray(data.queue.items)) {
        lines.push(`queue: ${data.queue.total ?? data.queue.items.length} song(s)`);
    }
    return lines.join('\n');
}

/** `folia_lyrics`: metadata plus timed lines when the handler included them. */
export function formatLyrics(data) {
    if (!data || typeof data !== 'object') {
        return compact(data);
    }
    if (data.available === false) {
        return 'lyrics: none for the current song';
    }
    const lines = [`lyrics: ${data.format ?? 'unknown'} · ${data.lineCount ?? 0} line(s) · current #${data.currentLineIndex ?? -1} · offset ${data.offsetMs ?? 0}ms`];
    const timed = Array.isArray(data.lines) ? data.lines : null;
    if (timed && timed.length > 0) {
        const current = data.currentLineIndex;
        for (const line of timed) {
            const marker = line.index === current ? '>' : ' ';
            const text = String(line.text ?? '').trim();
            lines.push(`${marker} [${formatSeconds(line.startTime)}] ${text}`);
        }
    } else if (data.currentLine) {
        lines.push(`current: [${formatSeconds(data.currentLine.startTime)}] ${String(data.currentLine.text ?? '').trim()}`);
    }
    return lines.join('\n');
}

/** `folia_visualizer_list`: registries keyed by kind. */
export function formatVisualizers(data) {
    if (!data || typeof data !== 'object') {
        return compact(data);
    }
    const lines = [];
    for (const [key, value] of Object.entries(data)) {
        if (Array.isArray(value)) {
            const names = value.map(entry => {
                if (typeof entry === 'string') {
                    return entry;
                }
                const id = entry?.id ?? entry?.name ?? entry?.mode;
                const label = entry?.label ?? entry?.title;
                return label ? `${id} (${label})` : compact(id ?? entry);
            });
            lines.push(`${key}: ${names.join(', ')}`);
        } else if (value !== null && typeof value === 'object') {
            lines.push(`${key}: ${compact(value)}`);
        } else if (value !== undefined) {
            lines.push(`${key}: ${compact(value)}`);
        }
    }
    return lines.length > 0 ? lines.join('\n') : JSON.stringify(data, null, 2);
}

/** `folia_tools`: catalog table. */
export function formatToolTable(tools) {
    const rows = (tools ?? []).map(tool => [
        tool.name ?? tool.id ?? '?',
        tool.group ?? '',
        tool.executor ?? '',
        tool.readOnly ? 'ro' : (tool.destructive ? 'danger' : ''),
        tool.title ?? tool.summary ?? '',
    ]);
    return `tools: ${rows.length}\n${renderTable(['NAME', 'GROUP', 'EXECUTOR', 'FLAGS', 'TITLE'], rows)}`;
}

/** `folia_palette_list`. */
export function formatPaletteList(data) {
    const commands = extractList(data, ['commands', 'items']) ?? [];
    const rows = commands.map(command => [
        command.id ?? '?',
        command.group ?? '',
        command.title ?? command.name ?? '',
        command.available === false ? 'unavailable' : 'ok',
    ]);
    return `commands: ${rows.length}\n${renderTable(['ID', 'GROUP', 'TITLE', 'STATUS'], rows)}`;
}

/** `folia_providers`. */
export function formatProviders(data) {
    const providers = extractList(data, ['providers']) ?? [];
    const rows = providers.map(provider => [
        provider.id ?? '?',
        provider.displayName ?? provider.name ?? '',
        provider.status ?? '',
        provider.requiresAccount ? 'yes' : 'no',
    ]);
    return `providers: ${rows.length}\n${renderTable(['ID', 'NAME', 'STATUS', 'ACCOUNT'], rows)}`;
}

/** `folia_settings_read`: flatten the snapshot to dotted paths. */
export function formatSettings(data) {
    if (!data || typeof data !== 'object') {
        return compact(data);
    }
    const lines = [];
    const walk = (value, prefix, depth) => {
        if (value === null || value === undefined) {
            lines.push(`${prefix} = ${compact(value)}`);
            return;
        }
        if (Array.isArray(value)) {
            lines.push(`${prefix} = ${compact(value)}`);
            return;
        }
        if (typeof value === 'object' && depth < 3) {
            for (const [key, child] of Object.entries(value)) {
                walk(child, prefix ? `${prefix}.${key}` : key, depth + 1);
            }
            return;
        }
        lines.push(`${prefix} = ${compact(value)}`);
    };
    walk(data, '', 0);
    return lines.join('\n');
}

/** `folia_screenshot`: saved path or a capture note (the base64 blob is never printed raw). */
export function formatScreenshot(data) {
    if (!data || typeof data !== 'object') {
        return compact(data);
    }
    const size = data.width && data.height ? ` (${data.width}x${data.height})` : '';
    if (data.path) {
        return `screenshot: saved ${data.path}${size}`;
    }
    const bytes = typeof data.base64 === 'string' ? Math.round((data.base64.length * 3) / 4) : 0;
    return `screenshot: captured${size} (${bytes} bytes of base64; pass --out <file> to write it to disk)`;
}

/** `folia_lyric_offset`. */
export function formatLyricOffset(data) {
    if (!data || typeof data !== 'object') {
        return compact(data);
    }
    const value = data.ms ?? data.offsetMs ?? data.deltaMs;
    return `lyric offset: ${value ?? '?'}ms (${data.scope ?? 'song'})`;
}

/** `folia_sleep_timer`. */
export function formatSleepTimer(data) {
    if (!data || typeof data !== 'object') {
        return compact(data);
    }
    const remaining = data.remainingMs ?? (typeof data.remainingSeconds === 'number' ? data.remainingSeconds * 1000 : null);
    if (remaining !== null && Number.isFinite(remaining) && remaining > 0) {
        return `sleep timer: ${formatDuration(remaining)} remaining`;
    }
    if (data.active === false || data.cancelled) {
        return 'sleep timer: off';
    }
    return `sleep timer: ${compact(data)}`;
}

/** `folia_appearance`. */
export function formatAppearance(data) {
    if (!data || typeof data !== 'object') {
        return compact(data);
    }
    const parts = [];
    if (data.daylight !== undefined) {
        parts.push(data.daylight ? 'day' : 'night');
    }
    if (data.followSystemTheme !== undefined) {
        parts.push(`follow system ${onOff(data.followSystemTheme)}`);
    }
    if (data.coverColorBg !== undefined) {
        parts.push(`cover color ${onOff(data.coverColorBg)}`);
    }
    if (data.staticMode !== undefined) {
        parts.push(`static ${onOff(data.staticMode)}`);
    }
    if (parts.length === 0) {
        return `appearance: ${compact(data)}`;
    }
    return `appearance: ${parts.join(' · ')}`;
}

/** `folia_library`: search-like list or a single action result. */
export function formatLibrary(data) {
    if (!data || typeof data !== 'object') {
        return compact(data);
    }
    const list = extractList(data, ['results', 'songs', 'items']);
    if (list) {
        return formatSearchResults({ ...data, results: list });
    }
    return JSON.stringify(data, null, 2);
}

/** `folia_volume`. */
export function formatVolume(data) {
    if (!data || typeof data !== 'object') {
        return compact(data);
    }
    if (data.percent === undefined && data.level === undefined) {
        return `volume: ${compact(data)}`;
    }
    return `volume: ${volumePercent(data)}%${data.muted ? ' (muted)' : ''}`;
}

/** Lookup table: tool name -> renderer. Unknown tools fall back to pretty JSON. */
const TOOL_FORMATTERS = {
    folia_status: formatStatus,
    folia_state: formatStateSnapshot,
    folia_tools: data => {
        const tools = extractList(data, ['tools']);
        return tools ? formatToolTable(tools) : JSON.stringify(data, null, 2);
    },
    folia_search: formatSearchResults,
    folia_queue: formatQueue,
    folia_lyrics: formatLyrics,
    folia_lyric_offset: formatLyricOffset,
    folia_lyric_seek: data => `lyric seek: ${compact(data)}`,
    folia_events: formatEventLines,
    folia_palette_list: formatPaletteList,
    folia_palette_run: data => `palette: ${data?.ok === false ? 'unavailable' : 'ok'}${data?.id ? ` (${data.id})` : ''}`,
    folia_palette_ui: data => `palette: ${data?.action ?? 'ok'}`,
    folia_visualizer_list: formatVisualizers,
    folia_visualizer_set: data => `visualizer: ${data?.mode ?? compact(data)}`,
    folia_background_set: data => `background: ${data?.mode ?? compact(data)}`,
    folia_visual_tuning: data => `visual tuning: ${data?.target ?? '?'} patched`,
    folia_video_layer: data => `video layer: ${onOff(data?.enabled)}`,
    folia_smart_beat: data => `smart beat: ${onOff(data?.enabled)}`,
    folia_appearance: formatAppearance,
    folia_providers: formatProviders,
    folia_library: formatLibrary,
    folia_settings_read: formatSettings,
    folia_settings_write: data => `settings: ${data?.key ?? '?'} = ${compact(data?.value)}`,
    folia_volume: formatVolume,
    folia_loop: data => `loop: ${data?.mode ?? compact(data)}`,
    folia_transport: data => `transport: ${data?.action ?? 'ok'}${data?.state ? ` (${data.state})` : ''}`,
    folia_sleep_timer: formatSleepTimer,
    folia_screenshot: formatScreenshot,
};

/** Render one successful tool result, or pretty JSON for shapes we do not know yet. */
export function formatToolResult(toolName, data, { json = false } = {}) {
    if (json) {
        return JSON.stringify(data ?? null, null, 2);
    }
    if (data === null || data === undefined) {
        return 'ok';
    }
    const formatter = TOOL_FORMATTERS[toolName];
    if (formatter) {
        try {
            return formatter(data);
        } catch {
            // Fall through to the generic JSON rendering below.
        }
    }
    if (typeof data === 'string') {
        return data;
    }
    return JSON.stringify(data, null, 2);
}

/** Multi-line description of a failed control envelope, including an actionable hint. */
export function describeEnvelopeError(envelope = {}, { verbose = false } = {}) {
    const error = envelope.error ?? {};
    const code = error.code ?? 'internal';
    const message = error.message ?? 'the control call failed';
    const lines = [`error (${code}): ${message}`];
    if (envelope.tool) {
        lines.push(`tool: ${envelope.tool}`);
    }
    if (error.details && typeof error.details === 'object' && Object.keys(error.details).length > 0) {
        lines.push(`details: ${compact(error.details)}`);
    }
    const hint = ERROR_HINTS[code] ?? NO_HINT;
    if (hint) {
        lines.push(`hint: ${hint}`);
    }
    if (verbose && typeof envelope.durationMs === 'number') {
        lines.push(`duration: ${envelope.durationMs}ms`);
    }
    return lines.join('\n');
}

/** Multi-line description of a transport failure (connection, auth, CDP). */
export function describeTransportError(error, { verbose = false } = {}) {
    const lines = [`connection failed (${error?.code ?? 'error'}): ${error?.message ?? String(error)}`];
    const hint = error?.hint || ERROR_HINTS[error?.code];
    if (hint) {
        lines.push(`hint: ${hint}`);
    }
    if (verbose && error?.stack) {
        lines.push(error.stack);
    }
    return lines.join('\n');
}

/** `folia doctor` report: one line per check plus the overall result. */
export function formatDoctorReport(checks, { exitCode = 0 } = {}) {
    const nameWidth = Math.max(8, ...checks.map(check => check.name.length));
    const lines = ['Folia control doctor'];
    for (const check of checks) {
        lines.push(`  ${padCell(check.name, nameWidth)}  ${check.ok ? 'ok  ' : 'FAIL'}  ${check.detail ?? ''}`);
        if (!check.ok && check.hint) {
            lines.push(`  ${' '.repeat(nameWidth)}  hint  ${check.hint}`);
        }
    }
    const failures = checks.filter(check => !check.ok).length;
    lines.push('');
    lines.push(failures === 0
        ? `result: PASS (${checks.length} checks)`
        : `result: FAIL (${failures} of ${checks.length} checks failed, exit ${exitCode})`);
    return lines.join('\n');
}

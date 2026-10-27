// control/lib/commands.mjs
// The PROTOCOL.md §5 command table: turns `folia <command> [args] [options]` into either a
// catalog tool invocation or a small client-side special case (mcp, doctor, event watch).

import path from 'node:path';
import { CONTROL_TOOL_NAMES } from '../../shared/controlCatalog.mjs';
import { UsageError } from './config.mjs';

export { UsageError };

const TRANSPORT_ACTIONS = new Map([
    ['pause', 'pause'],
    ['resume', 'play'],
    ['toggle', 'toggle'],
    ['next', 'next'],
    ['prev', 'prev'],
    ['stop', 'stop'],
]);

const LOOP_MODES = ['off', 'all', 'one'];
const REPLAYGAIN_MODES = ['off', 'track', 'album'];
const PANEL_TABS = ['cover', 'controls', 'queue', 'account', 'local', 'navi', 'onlineLyrics', 'lyrics'];
const VIEWS = ['home', 'player', 'lattice'];
const THEME_MODES = new Map([
    ['day', { daylight: true }],
    ['night', { daylight: false }],
    ['system', { followSystemTheme: true }],
    ['cover', { coverColorBg: true }],
    ['static', { staticMode: true }],
    ['ai', { generateAITheme: true }],
]);

function plan(tool, args = {}) {
    return { tool, args };
}

function special(name, extra = {}) {
    return { special: name, ...extra };
}

function requireArgs(args, count, usage) {
    if (args.length < count) {
        throw new UsageError(`missing argument for "${usage}"`, 'run "folia --help" for the command list');
    }
}

function collectText(args, from = 0) {
    return args.slice(from).join(' ').trim();
}

function toNumber(value, label, { min, max } = {}) {
    const text = String(value).trim().replace(/%$/, '');
    const number = Number(text);
    if (!Number.isFinite(number)) {
        throw new UsageError(`${label} must be a number (got "${value}")`);
    }
    if (min !== undefined && number < min) {
        throw new UsageError(`${label} must be at least ${min} (got "${value}")`);
    }
    if (max !== undefined && number > max) {
        throw new UsageError(`${label} must be at most ${max} (got "${value}")`);
    }
    return number;
}

function toInteger(value, label, { min, max } = {}) {
    const number = toNumber(value, label, { min, max });
    if (!Number.isInteger(number)) {
        throw new UsageError(`${label} must be an integer (got "${value}")`);
    }
    return number;
}

function toEnum(value, allowed, label) {
    const text = String(value);
    if (!allowed.includes(text)) {
        throw new UsageError(`${label} must be one of ${allowed.join('|')} (got "${value}")`);
    }
    return text;
}

function toBoolean(value, label) {
    const text = String(value).toLowerCase();
    if (['on', 'true', '1', 'yes'].includes(text)) {
        return true;
    }
    if (['off', 'false', '0', 'no'].includes(text)) {
        return false;
    }
    throw new UsageError(`${label} must be on or off (got "${value}")`);
}

function maybeBoolean(args, position, label) {
    return args.length > position ? toBoolean(args[position], label) : undefined;
}

function parseJson(text, label) {
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new UsageError(`${label} is not valid JSON: ${error.message}`, `quote the JSON, e.g. '{"level":30}'`);
    }
}

/** Settings values are typed where possible: numbers, booleans, null, JSON objects, else string. */
function parseSettingValue(text) {
    const trimmed = String(text);
    try {
        return JSON.parse(trimmed);
    } catch {
        return trimmed;
    }
}

/** Seconds, `mm:ss`/`hh:mm:ss`, or `%` -> the folia_seek arguments. */
function parseSeek(value) {
    const text = String(value).trim();
    if (text.endsWith('%')) {
        return { percent: toNumber(text.slice(0, -1), 'seek percent', { min: 0, max: 100 }) };
    }
    if (text.includes(':')) {
        const parts = text.split(':').map(part => toNumber(part, 'seek position', { min: 0 }));
        if (parts.length === 2) {
            return { seconds: parts[0] * 60 + parts[1] };
        }
        if (parts.length === 3) {
            return { seconds: parts[0] * 3600 + parts[1] * 60 + parts[2] };
        }
        throw new UsageError(`seek position must be seconds, mm:ss or hh:mm:ss (got "${value}")`);
    }
    return { seconds: toNumber(text, 'seek seconds', { min: 0 }) };
}

/** Sleep timer accepts plain minutes plus the usual `1h30m` / `90m` / `2h` shorthands. */
function parseSleepMinutes(value) {
    const text = String(value).trim().toLowerCase();
    if (/^\d+$/.test(text)) {
        return Number(text);
    }
    const match = /^(?:(\d+)h)?(?:(\d+)m)?$/.exec(text);
    if (!match || (match[1] === undefined && match[2] === undefined)) {
        throw new UsageError(`sleep time must be minutes, "90m", "1h" or "1h30m" (got "${value}")`);
    }
    return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
}

function queuePlan(args, options) {
    const subcommand = args[0] ?? 'list';
    switch (subcommand) {
        case 'list': {
            const queueArgs = {};
            if (options.offset !== undefined) {
                queueArgs.offset = toInteger(options.offset, '--offset', { min: 0 });
            }
            if (options.limit !== undefined) {
                queueArgs.limit = toInteger(options.limit, '--limit', { min: 1, max: 100 });
            }
            return plan('folia_queue', queueArgs);
        }
        case 'play': {
            requireArgs(args, 2, 'folia queue play <index>');
            return plan('folia_queue_play', { index: toInteger(args[1], 'queue index', { min: 0 }) });
        }
        case 'add': {
            requireArgs(args, 2, 'folia queue add <query>');
            const addArgs = { query: collectText(args, 1) };
            if (options.provider) {
                addArgs.provider = options.provider;
            }
            if (options.index !== undefined) {
                addArgs.index = toInteger(options.index, '--index', { min: 0 });
            }
            if (options.next) {
                addArgs.position = 'next';
            } else if (options.end) {
                addArgs.position = 'end';
            }
            return plan('folia_queue_add', addArgs);
        }
        case 'remove': {
            if (args.length < 2) {
                throw new UsageError('missing queue index for "folia queue remove <index...>"', 'run folia queue to read indices');
            }
            const indices = args.slice(1).map((value, position) => (
                toInteger(value, `queue index #${position + 1}`, { min: 0 })
            ));
            return plan('folia_queue_remove', indices.length === 1 ? { index: indices[0] } : { indices });
        }
        case 'move': {
            if (args[1] === undefined) {
                throw new UsageError('missing source index for "folia queue move <from> <to>"', 'run folia queue to read indices');
            }
            const from = toInteger(args[1], 'source index', { min: 0 });
            if (options.next) {
                return plan('folia_queue_move', { from, toNext: true });
            }
            if (options.end) {
                return plan('folia_queue_move', { from, toEnd: true });
            }
            const destination = args[2];
            if (destination === undefined) {
                throw new UsageError('missing destination for "folia queue move <from> <to>"', 'use an index, "next" or "end"');
            }
            if (destination === 'next') {
                return plan('folia_queue_move', { from, toNext: true });
            }
            if (destination === 'end') {
                return plan('folia_queue_move', { from, toEnd: true });
            }
            return plan('folia_queue_move', { from, to: toInteger(destination, 'destination index', { min: 0 }) });
        }
        case 'clear':
            return plan('folia_queue_clear');
        default:
            throw new UsageError(`unknown queue subcommand "${subcommand}"`, 'queue commands: list, play, add, remove, move, clear');
    }
}

function lyricsPlan(args, options) {
    const subcommand = args[0];
    if (subcommand === 'offset') {
        const offsetArgs = { scope: options.global ? 'global' : 'song' };
        if (options.delta !== undefined && args[1] !== undefined) {
            throw new UsageError('pass either an absolute offset or --delta, not both');
        }
        if (args[1] !== undefined) {
            offsetArgs.ms = toNumber(args[1], 'lyric offset ms', { min: -60000, max: 60000 });
        } else if (options.delta !== undefined) {
            offsetArgs.deltaMs = toNumber(options.delta, '--delta', { min: -5000, max: 5000 });
        } else {
            throw new UsageError('missing offset value for "folia lyrics offset <ms>"', 'or pass --delta <ms>');
        }
        return plan('folia_lyric_offset', offsetArgs);
    }
    if (subcommand === 'seek') {
        if (args[1] !== undefined) {
            return plan('folia_lyric_seek', { lineIndex: toInteger(args[1], 'lyric line index', { min: 0 }) });
        }
        throw new UsageError('missing line index for "folia lyrics seek <line>"', 'run folia lyrics --lines to list indices');
    }
    const lyricsArgs = {};
    if (options.lines || options.all) {
        lyricsArgs.includeLines = true;
    }
    if (options.limit !== undefined) {
        lyricsArgs.limit = toInteger(options.limit, '--limit', { min: 1, max: 2000 });
    }
    return plan('folia_lyrics', lyricsArgs);
}

function visualPlan(args) {
    const subcommand = args[0];
    switch (subcommand) {
        case 'list':
            return plan('folia_visualizer_list');
        case 'set': {
            requireArgs(args, 2, 'folia visual set <mode>');
            return plan('folia_visualizer_set', { mode: args[1] });
        }
        case 'bg': {
            requireArgs(args, 2, 'folia visual bg <mode>');
            return plan('folia_background_set', { mode: args[1] });
        }
        case 'tune': {
            requireArgs(args, 3, 'folia visual tune <monet|latent> \'<json>\'');
            const target = toEnum(args[1], ['monet', 'latent'], 'tuning target');
            const patch = parseJson(args.slice(2).join(' '), 'tuning patch');
            if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
                throw new UsageError('tuning patch must be a JSON object');
            }
            return plan('folia_visual_tuning', { target, patch });
        }
        case 'video': {
            const enabled = maybeBoolean(args, 1, 'video layer state');
            return plan('folia_video_layer', enabled === undefined ? {} : { enabled });
        }
        default:
            throw new UsageError(`unknown visual subcommand "${subcommand ?? ''}"`, 'visual commands: list, set, bg, tune, video');
    }
}

/**
 * Resolve the parsed argv into a plan.
 * - `{ tool, args }`: call the catalog tool through the transport.
 * - `{ special, ... }`: client-side behaviour (`help`, `version`, `mcp`, `doctor`,
 *   `events-watch`, `mute-toggle`, `call-stdin`, `eval-stdin`).
 */
/** Validate ID playback before reading connection configuration or invoking any tool. */
export function validateCommandUsage(parsed) {
    if (parsed.command !== 'play' || parsed.options.id === undefined) return;
    if (!String(parsed.options.id).trim()) throw new UsageError('play --id requires a nonempty song ID');
    if (typeof parsed.options.provider !== 'string' || !parsed.options.provider.trim()) {
        throw new UsageError('play --id requires --provider <provider>',
            'use folia providers, then folia play --provider <provider> --id <id>; for local files use folia library play <id>');
    }
}

export function resolveCommand(parsed, config = {}) {
    validateCommandUsage(parsed);
    const command = parsed.command;
    const args = parsed.args ?? [];
    const options = parsed.options ?? {};
    const allowEval = config.allowEval === true;

    if (command === null || command === 'help') {
        return special('help');
    }
    if (command === 'version') {
        return special('version');
    }
    if (command === 'mcp') {
        return special('mcp');
    }
    if (command === 'doctor') {
        return special('doctor');
    }

    switch (command) {
        // -------------------------------------------------------------------------------------
        // Introspection
        // -------------------------------------------------------------------------------------
        case 'status':
            return plan('folia_status');
        case 'state': {
            const stateArgs = {};
            if (options.noQueue) {
                stateArgs.includeQueue = false;
            }
            if (options.lyrics) {
                stateArgs.includeLyrics = true;
            }
            return plan('folia_state', stateArgs);
        }
        case 'tools': {
            const toolsArgs = {};
            if (options.group) {
                toolsArgs.group = options.group;
            }
            return plan('folia_tools', toolsArgs);
        }

        // -------------------------------------------------------------------------------------
        // Search / playback
        // -------------------------------------------------------------------------------------
        case 'search': {
            requireArgs(args, 1, 'folia search <query>');
            const searchArgs = { query: collectText(args) };
            if (options.provider) {
                searchArgs.provider = options.provider;
            }
            if (options.source) {
                searchArgs.source = options.source;
            }
            if (options.limit !== undefined) {
                searchArgs.limit = toInteger(options.limit, '--limit', { min: 1, max: 50 });
            }
            if (options.offset !== undefined) {
                searchArgs.offset = toInteger(options.offset, '--offset', { min: 0 });
            }
            return plan('folia_search', searchArgs);
        }
        case 'play': {
            // --view 决定放歌后落到哪个界面；不传就是 player（播放页，那里有歌词动画）。
            const viewArgs = options.view ? { view: String(options.view) } : {};
            if (options.id) {
                const playArgs = { id: options.id, ...viewArgs };
                if (options.provider) {
                    playArgs.provider = options.provider;
                }
                return plan('folia_play', playArgs);
            }
            requireArgs(args, 1, 'folia play <query> | folia play --id <song-id>');
            const playArgs = { query: collectText(args), ...viewArgs };
            if (options.provider) {
                playArgs.provider = options.provider;
            }
            if (options.index !== undefined) {
                playArgs.index = toInteger(options.index, '--index', { min: 0 });
            }
            if (options.source) {
                playArgs.source = options.source;
            }
            return plan('folia_play_search', playArgs);
        }
        case 'pause':
        case 'resume':
        case 'toggle':
        case 'next':
        case 'prev':
        case 'stop':
            return plan('folia_transport', { action: TRANSPORT_ACTIONS.get(command) });
        case 'seek': {
            requireArgs(args, 1, 'folia seek <seconds|percent|mm:ss>');
            return plan('folia_seek', parseSeek(args[0]));
        }
        case 'volume': {
            const volumeArgs = {};
            if (args[0] !== undefined) {
                volumeArgs.level = toNumber(args[0], 'volume level', { min: 0, max: 100 });
            }
            if (options.delta !== undefined) {
                volumeArgs.delta = toNumber(options.delta, '--delta', { min: -100, max: 100 });
            }
            if (Object.keys(volumeArgs).length === 0) {
                volumeArgs.status = true;
            }
            return plan('folia_volume', volumeArgs);
        }
        case 'mute': {
            if (args[0] === undefined) {
                return special('mute-toggle');
            }
            return plan('folia_volume', { mute: toBoolean(args[0], 'mute state') });
        }
        case 'loop': {
            if (args[0] === undefined) {
                return plan('folia_loop', { cycle: true });
            }
            return plan('folia_loop', { mode: toEnum(args[0], LOOP_MODES, 'loop mode') });
        }
        case 'shuffle':
            return plan('folia_shuffle');
        case 'like': {
            const liked = maybeBoolean(args, 0, 'like state');
            return plan('folia_like', liked === undefined ? {} : { liked });
        }
        case 'replaygain': {
            if (args[0] === undefined) {
                return plan('folia_replaygain', {});
            }
            return plan('folia_replaygain', { mode: toEnum(args[0], REPLAYGAIN_MODES, 'ReplayGain mode') });
        }
        case 'sleep': {
            if (options.cancel) {
                return plan('folia_sleep_timer', { cancel: true });
            }
            if (options.status || (args.length === 0 && options.hours === undefined)) {
                return plan('folia_sleep_timer', { status: true });
            }
            const sleepArgs = {};
            if (options.hours !== undefined) {
                sleepArgs.hours = toInteger(options.hours, '--hours', { min: 0, max: 999 });
            }
            if (args[0] !== undefined) {
                const totalMinutes = parseSleepMinutes(args[0]);
                sleepArgs.hours = Math.floor(totalMinutes / 60);
                sleepArgs.minutes = totalMinutes % 60;
            }
            return plan('folia_sleep_timer', sleepArgs);
        }

        // -------------------------------------------------------------------------------------
        // Queue / lyrics / visualizer
        // -------------------------------------------------------------------------------------
        case 'queue':
            return queuePlan(args, options);
        case 'lyrics':
            return lyricsPlan(args, options);
        case 'visual':
            return visualPlan(args);
        case 'smartbeat': {
            const enabled = maybeBoolean(args, 0, 'smart beat state');
            return plan('folia_smart_beat', enabled === undefined ? {} : { enabled });
        }
        case 'video': {
            const enabled = maybeBoolean(args, 0, 'video layer state');
            return plan('folia_video_layer', enabled === undefined ? {} : { enabled });
        }
        case 'theme': {
            if (args[0] === undefined) {
                return plan('folia_appearance', {});
            }
            const themeArgs = THEME_MODES.get(args[0]);
            if (!themeArgs) {
                throw new UsageError(`unknown theme "${args[0]}"`, `theme modes: ${[...THEME_MODES.keys()].join('|')}`);
            }
            return plan('folia_appearance', { ...themeArgs });
        }

        // -------------------------------------------------------------------------------------
        // Settings / navigation / libraries
        // -------------------------------------------------------------------------------------
        case 'settings': {
            const subcommand = args[0];
            if (subcommand === 'set') {
                requireArgs(args, 3, 'folia settings set <key> <value>');
                return plan('folia_settings_write', {
                    key: args[1],
                    value: parseSettingValue(args.slice(2).join(' ')),
                });
            }
            if (subcommand === 'open') {
                return plan('folia_settings_open', args[1] ? { subview: args[1] } : {});
            }
            const readArgs = {};
            if (args[0]) {
                readArgs.store = args[0];
            }
            if (args[1]) {
                readArgs.key = args[1];
            }
            return plan('folia_settings_read', readArgs);
        }
        case 'nav': {
            requireArgs(args, 1, 'folia nav <home|player|lattice>');
            return plan('folia_navigate', { view: toEnum(args[0], VIEWS, 'view') });
        }
        case 'panel': {
            const panelArgs = {};
            const token = args[0];
            if (token === 'close') {
                panelArgs.open = false;
            } else if (token === 'open') {
                panelArgs.open = true;
            } else if (token) {
                panelArgs.tab = toEnum(token, PANEL_TABS, 'panel tab');
            }
            if (options.close) {
                panelArgs.open = false;
            }
            return plan('folia_panel', panelArgs);
        }
        case 'palette': {
            const subcommand = args[0];
            if (subcommand === 'list') {
                const listArgs = {};
                if (args[1]) {
                    listArgs.query = collectText(args, 1);
                }
                if (options.all) {
                    listArgs.includeUnavailable = true;
                }
                if (options.hidden) {
                    listArgs.includeHidden = true;
                }
                return plan('folia_palette_list', listArgs);
            }
            if (subcommand === 'run') {
                requireArgs(args, 2, 'folia palette run <command-id> [input]');
                const runArgs = { id: args[1] };
                if (args.length > 2) {
                    runArgs.input = collectText(args, 2);
                }
                return plan('folia_palette_run', runArgs);
            }
            return plan('folia_palette_ui', { action: options.close ? 'close' : 'open' });
        }
        case 'library': {
            const subcommand = args[0] ?? 'list';
            if (subcommand === 'search') {
                requireArgs(args, 2, 'folia library search <query>');
                return plan('folia_library', { action: 'search', query: collectText(args, 1) });
            }
            if (subcommand === 'play') {
                requireArgs(args, 2, 'folia library play <id>');
                return plan('folia_library', { action: 'play', id: args[1] });
            }
            if (subcommand === 'list') {
                const listArgs = { action: 'list' };
                if (options.offset !== undefined) {
                    listArgs.offset = toInteger(options.offset, '--offset', { min: 0 });
                }
                if (options.limit !== undefined) {
                    listArgs.limit = toInteger(options.limit, '--limit', { min: 1, max: 100 });
                }
                return plan('folia_library', listArgs);
            }
            throw new UsageError(`unknown library subcommand "${subcommand}"`, 'library commands: list, search <query>, play <id>');
        }
        case 'providers':
            return plan('folia_providers');

        // -------------------------------------------------------------------------------------
        // Window / system
        // -------------------------------------------------------------------------------------
        case 'window': {
            const subcommand = args[0] ?? 'status';
            switch (subcommand) {
                case 'status':
                case 'minimize':
                case 'maximize':
                case 'fullscreen':
                case 'close':
                    return plan('folia_window', { action: subcommand });
                case 'on-top':
                case 'always-on-top': {
                    const value = maybeBoolean(args, 1, 'always-on-top state');
                    return plan('folia_window', value === undefined ? { action: 'alwaysOnTop' } : { action: 'alwaysOnTop', value });
                }
                case 'click-through': {
                    const value = maybeBoolean(args, 1, 'click-through state');
                    return plan('folia_window', value === undefined ? { action: 'clickThrough' } : { action: 'clickThrough', value });
                }
                default:
                    throw new UsageError(
                        `unknown window action "${subcommand}"`,
                        'window actions: status, minimize, maximize, fullscreen, on-top, click-through, close',
                    );
            }
        }
        case 'screenshot': {
            const screenshotArgs = { save: !options.noSave };
            if (options.out) {
                screenshotArgs.path = path.resolve(String(options.out));
            }
            return plan('folia_screenshot', screenshotArgs);
        }
        case 'toast': {
            requireArgs(args, 1, 'folia toast <text>');
            const toastArgs = { text: collectText(args) };
            if (options.type) {
                toastArgs.type = toEnum(options.type, ['info', 'success', 'error'], '--type');
            }
            if (options.duration !== undefined) {
                toastArgs.durationMs = toInteger(options.duration, '--duration', { min: 500, max: 60000 });
            }
            return plan('folia_toast', toastArgs);
        }
        case 'events': {
            const eventsArgs = {};
            if (options.since !== undefined) {
                eventsArgs.since = toInteger(options.since, '--since', { min: 0 });
            }
            if (options.limit !== undefined) {
                eventsArgs.limit = toInteger(options.limit, '--limit', { min: 1, max: 200 });
            }
            if (options.watch) {
                return special('events-watch', { args: eventsArgs });
            }
            return plan('folia_events', eventsArgs);
        }

        // -------------------------------------------------------------------------------------
        // Escape hatches
        // -------------------------------------------------------------------------------------
        case 'call': {
            requireArgs(args, 2, 'folia call <tool> \'<json>\'');
            const tool = args[0];
            if (!CONTROL_TOOL_NAMES.has(tool)) {
                throw new UsageError(`unknown tool "${tool}"`, 'run "folia tools" to list catalog tool names');
            }
            const raw = args.slice(1).join(' ');
            if (raw === '-') {
                return special('call-stdin', { tool });
            }
            const callArgs = parseJson(raw, 'tool arguments');
            if (callArgs === null || typeof callArgs !== 'object' || Array.isArray(callArgs)) {
                throw new UsageError('tool arguments must be a JSON object');
            }
            return plan(tool, callArgs);
        }
        case 'eval': {
            if (!allowEval) {
                throw new UsageError(
                    'folia eval requires --allow-eval',
                    're-run with --allow-eval; the app must also run with FOLIA_CONTROL_ALLOW_EVAL=1',
                );
            }
            if (options.stdin) {
                return special('eval-stdin');
            }
            requireArgs(args, 1, 'folia eval \'<expression>\'');
            return plan('folia_eval', { expression: collectText(args) });
        }
        case 'quit': {
            if (!options.yes) {
                throw new UsageError('folia quit needs --yes', 'quitting is destructive: pass --yes only when the user asked for it');
            }
            return plan('folia_quit', { confirm: true });
        }

        default:
            throw new UsageError(`unknown command "${command}"`, 'run "folia --help" for the command list');
    }
}

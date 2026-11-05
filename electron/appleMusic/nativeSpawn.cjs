'use strict';

const { EventEmitter } = require('node:events');
const { createHash } = require('node:crypto');
const { createRequestDispatcher, validateRequest } = require('./companionRequests.cjs');
const { storefrontTarget } = require('./companionStorefront.cjs');

// Commands that start the player; the page must be visible until it sounds.
const STARTS = new Set(['playSong', 'playStation', 'resume']);
// The companion client asks again after these, so they do not end a start.
const RETRIED = new Set(['not-ready', 'busy']);
// A host control answers at once; the page gives up a start after 60 s (companionRequests.cjs),
// so a pin never needs to outlive that.
const PIN_BUDGET_MS = 3000;
const PIN_LIMIT_MS = 65000;

// Chromium defers media loading in a hidden page whose WebContents never played media
// (prerender::DeferMediaLoad), and the Windows host's page is hidden with its window: MusicKit takes
// the license but never buffers. So each start keeps the page visible until the player sounds; once
// played, Chromium loads later media even while hidden, and a hidden page plays at 3-6% of a core
// against about 20% visible. A host without the control (macOS) answers invalid-request once and is
// not asked again. Each start takes a ticket, so the end of an older request never unpins a newer start.
function createVisibilityPin(command, { limitMs = PIN_LIMIT_MS } = {}) {
    let latest = 0; // ticket of the latest start
    let settled = 0; // ticket of the latest start whose page command answered
    let pinned = false; // the host may be keeping the page visible
    let supported = true;
    let previous = null; // position of the previous playing status since the latest start
    let limit = null;

    const send = active => command('keepVisible', { active }, PIN_BUDGET_MS).then(answer => {
        if (answer.ok || answer.error === 'disconnected') return;
        if (answer.error === 'invalid-request') {
            supported = false;
            pinned = false;
            if (process.platform === 'win32') console.warn('[AppleMusic] The host does not know keepVisible; a start with the window hidden may stall');
            return;
        }
        console.warn('[AppleMusic] The host did not answer keepVisible', { active, error: answer.error });
    });
    const release = () => {
        if (limit) { clearTimeout(limit); limit = null; }
        if (!pinned) return;
        pinned = false;
        void send(false);
    };
    // Two playing answers in a row with the position moving (a live station has none): one answer
    // alone can catch MusicKit's brief "playing" before it starts loading. Progress of any song
    // releases: a page that played is no longer deferred.
    const sounded = status => {
        if (status.isPlaying !== true) { previous = null; return false; }
        const position = status.live === true ? 0 : Number(status.positionMs) || 0;
        const moving = previous !== null && (status.live === true || position > previous);
        previous = position;
        return moving;
    };
    return {
        // Before a request goes to the page; `after` takes back what this returns.
        before(operation) {
            const arrival = { ticket: 0, latest, settled };
            if (!STARTS.has(operation)) return arrival;
            arrival.ticket = ++latest;
            previous = null;
            if (!supported) return arrival;
            pinned = true;
            if (limit) clearTimeout(limit);
            limit = setTimeout(release, limitMs);
            limit.unref?.();
            // Not awaited: the host answers controls in order, so the page is visible before this
            // start's page command runs, and a later pause cannot overtake the start.
            void send(true);
            return arrival;
        },
        after(operation, result, arrival) {
            if (STARTS.has(operation)) {
                if (arrival.ticket > settled) settled = arrival.ticket;
                if (!result.ok && !RETRIED.has(result.error) && arrival.ticket === latest) release();
            } else if (operation === 'pause') {
                if (arrival.latest === latest) release();
            } else if (operation === 'playbackStatus') {
                if (result.ok) {
                    if (sounded(result.data || {})) release();
                } else if (result.error === 'playback-failed' && arrival.latest === latest && arrival.settled === latest) {
                    // The page keeps a failed start until the next start replaces it: the failure
                    // counts only when it answers for the latest start, after that start reached the page.
                    release();
                }
            }
        },
        end: release,
    };
}

// Adapt a native stdin/stdout child to the private child-channel contract used by companionClient.
function createNativeSpawn({ spawnProcess, timeoutMs = 25000, pinLimitMs = PIN_LIMIT_MS }) {
    return (binary, args) => {
        const profilePath = args.find(arg => arg.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length);
        if (!profilePath) throw new Error('Native companion profile is required');
        const hex = createHash('sha256').update(profilePath).digest('hex').slice(0, 32);
        const store = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
        const native = spawnProcess(binary, [`--profile=${profilePath}`, `--store=${store}`], { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
        const bridge = new EventEmitter();
        bridge.connected = true;
        let sequence = 0;
        let generation = 0;
        let currentUrl = 'about:blank';
        let buffered = '';
        let sessionBusy = false;
        let exitTimer;
        const pending = new Map();

        const failPending = () => {
            for (const request of pending.values()) {
                clearTimeout(request.timer);
                request.resolve({ ok: false, error: 'disconnected' });
            }
            pending.clear();
        };
        const finish = () => {
            if (exitTimer) clearTimeout(exitTimer);
            if (!bridge.connected) { failPending(); return; }
            bridge.connected = false;
            failPending();
            bridge.emit('disconnect');
        };

        // Only fixed host controls and parent-built expressions are sent; the renderer cannot supply scripts.
        const command = (operation, fields = {}, budgetMs = timeoutMs) => new Promise(resolve => {
            if (!bridge.connected || pending.size >= 24) return resolve({ ok: false, error: 'disconnected' });
            const id = `native_${++sequence}`;
            const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: 'timeout' }); }, budgetMs);
            pending.set(id, { resolve, timer });
            const payload = JSON.stringify({ id, operation, ...fields }) + '\n';
            try {
                native.stdin.write(payload, error => {
                    if (!error) return;
                    const entry = pending.get(id);
                    if (!entry) return;
                    clearTimeout(entry.timer);
                    pending.delete(id);
                    entry.resolve({ ok: false, error: 'disconnected' });
                });
            } catch { failPending(); }
        });

        native.stdout.setEncoding('utf8');
        native.stdout.on('data', chunk => {
            buffered += chunk;
            if (buffered.length > 8 * 1024 * 1024) { bridge.disconnect(); return; }
            const lines = buffered.split('\n');
            buffered = lines.pop() ?? '';
            for (const line of lines) {
                let message;
                try { message = JSON.parse(line); } catch { continue; }
                // Forward only fixed host lifecycle codes, never arbitrary page or runtime output.
                if (message?.event === 'diagnostic' && ['environment-ready', 'environment-failed', 'show', 'hide', 'navigation-failed', 'process-failed', 'visibility-pin-unavailable'].includes(message.code)) {
                    console.info('[AppleMusic] Native companion:', message.code);
                    continue;
                }
                if (message?.event === 'document' && Number.isSafeInteger(message.generation)) {
                    generation = message.generation;
                    currentUrl = message.ready === true && typeof message.url === 'string' ? message.url : 'about:blank';
                    continue;
                }
                if (typeof message?.id !== 'string' || typeof message.ok !== 'boolean') continue;
                const entry = pending.get(message.id);
                if (!entry) continue;
                clearTimeout(entry.timer);
                pending.delete(message.id);
                entry.resolve(message);
            }
        });
        // Native/WebKit diagnostic text is not forwarded: it may contain private page details.
        native.stderr?.resume();
        native.stdin.on('error', () => bridge.disconnect());
        native.stdout.on('error', () => bridge.disconnect());
        native.once('error', finish);
        native.once('exit', finish);

        const navigate = async (url, budgetMs = timeoutMs) => (await command('navigate', { url }, budgetMs)).ok === true;
        const recover = async () => {
            const target = currentUrl.startsWith('https://music.apple.com/') ? currentUrl : 'https://music.apple.com/';
            const deadline = Date.now() + 8000;
            if (!(await navigate('about:blank', 8000)) || !(await navigate(target, Math.max(1, deadline - Date.now())))) { bridge.disconnect(); return false; }
            return true;
        };
        const contents = {
            isDestroyed: () => !bridge.connected,
            getURL: () => currentUrl,
            executeJavaScript: async expression => {
                const result = await command('evaluate', { expression });
                return result.ok ? result.data : { ok: false, error: result.error === 'not-ready' ? 'not-ready' : 'request-failed' };
            },
        };
        const dispatch = createRequestDispatcher(() => contents, 20000, () => generation, recover);
        const visibility = createVisibilityPin(command, { limitMs: pinLimitMs });

        bridge.send = (message, callback) => {
            callback?.();
            const request = validateRequest(message);
            if (!request) { queueMicrotask(() => bridge.emit('message', { id: message.id, ok: false, error: 'invalid-request' })); return; }
            void (async () => {
                let result;
                if (sessionBusy) result = { ok: false, error: 'busy' };
                else if (request.operation === 'showWindow') result = await command('show');
                else if (request.operation === 'hideWindow') result = await command('hide');
                else if (request.operation === 'logout') {
                    sessionBusy = true;
                    visibility.end();
                    try {
                        const stopped = await navigate('about:blank');
                        const cleared = stopped && (await command('clear')).ok;
                        const loaded = cleared && await navigate('https://music.apple.com/');
                        result = loaded ? { ok: true, data: {} } : { ok: false, error: 'request-failed' };
                        if (!loaded) bridge.disconnect();
                    } finally { sessionBusy = false; }
                } else {
                    const arrival = visibility.before(request.operation);
                    result = await dispatch(request);
                    visibility.after(request.operation, result, arrival);
                }
                if (request.operation === 'accountStatus' && result.ok) {
                    const target = storefrontTarget(currentUrl, result.data?.storefront);
                    if (target && !(await navigate(target))) result = { ok: false, error: 'not-ready' };
                }
                if (bridge.connected) bridge.emit('message', { ...result, id: request.id });
            })().catch(() => {
                if (bridge.connected) bridge.emit('message', { id: request.id, ok: false, error: 'request-failed' });
            });
        };
        bridge.disconnect = () => {
            if (!bridge.connected) return;
            bridge.connected = false;
            failPending();
            native.stdin.end();
            // EOF normally exits immediately; retain a bounded fallback for a wedged WebKit process.
            exitTimer = setTimeout(() => native.kill('SIGKILL'), 1500);
            exitTimer.unref?.();
            bridge.emit('disconnect');
        };
        return bridge;
    };
}

module.exports = { createNativeSpawn };

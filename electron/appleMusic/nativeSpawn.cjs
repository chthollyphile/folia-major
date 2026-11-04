'use strict';

const { EventEmitter } = require('node:events');
const { createHash } = require('node:crypto');
const { createRequestDispatcher, validateRequest } = require('./companionRequests.cjs');
const { storefrontTarget } = require('./companionStorefront.cjs');

// Adapt a native stdin/stdout child to the private child-channel contract used by companionClient.
function createNativeSpawn({ spawnProcess, timeoutMs = 25000 }) {
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
                if (message?.event === 'diagnostic' && ['environment-ready', 'environment-failed', 'show', 'hide', 'navigation-failed', 'process-failed'].includes(message.code)) {
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
                    try {
                        const stopped = await navigate('about:blank');
                        const cleared = stopped && (await command('clear')).ok;
                        const loaded = cleared && await navigate('https://music.apple.com/');
                        result = loaded ? { ok: true, data: {} } : { ok: false, error: 'request-failed' };
                        if (!loaded) bridge.disconnect();
                    } finally { sessionBusy = false; }
                } else result = await dispatch(request);
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

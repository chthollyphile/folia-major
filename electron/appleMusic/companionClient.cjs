'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const { validateRequest } = require('./companionRequests.cjs');

// The child inherits one private IPC channel; neither process opens a network listener.
function createCompanionClient({ runtimePath, profilePath, spawnProcess = spawn, timeoutMs = 25000 }) {
    let child = null;
    let sequence = 0;
    const pending = new Map();

    // A lost child invalidates every outstanding request without exposing raw process errors.
    function failPending(error) {
        for (const entry of pending.values()) {
            clearTimeout(entry.timer);
            entry.resolve({ ok: false, error });
        }
        pending.clear();
    }

    // The companion's own lines go into Folia's log too (the app panel reads this process's
    // console). Chromium's stdout/stderr noise is left out: only lines the companion marks.
    function forwardCompanionLogs(instance) {
        const forward = (stream, warn) => {
            if (!stream || typeof stream.on !== 'function') return;
            let buffered = '';
            if (typeof stream.setEncoding === 'function') stream.setEncoding('utf8');
            stream.on('data', chunk => {
                buffered += String(chunk);
                const lines = buffered.split('\n');
                buffered = lines.pop() ?? '';
                for (const line of lines) {
                    if (!line.includes('[AppleMusic]')) continue;
                    const text = line.length > 500 ? `${line.slice(0, 500)}…` : line;
                    if (warn) console.warn(text);
                    else console.info(text);
                }
            });
            stream.on('error', () => {});
        };
        forward(instance.stdout, false);
        forward(instance.stderr, true);
    }

    function start() {
        if (child?.connected) return true;
        if (!path.isAbsolute(runtimePath || '') || !path.isAbsolute(profilePath || '')) return false;
        const args = [path.join(__dirname, 'companion.cjs'), `--user-data-dir=${profilePath}`];
        args.push('--folia-companion-hidden');
        const instance = spawnProcess(runtimePath, args, { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], shell: false });
        child = instance;
        forwardCompanionLogs(instance);
        instance.on('message', message => {
            if (instance !== child || !message || typeof message !== 'object' || typeof message.id !== 'string') return;
            const entry = pending.get(message.id);
            if (!entry || typeof message.ok !== 'boolean') return;
            clearTimeout(entry.timer);
            pending.delete(message.id);
            entry.resolve(message);
        });
        const onClosed = () => {
            if (child !== instance) return;
            child = null;
            failPending('disconnected');
        };
        instance.once('error', onClosed);
        instance.once('exit', onClosed);
        instance.once('disconnect', onClosed);
        return true;
    }

    // One attempt on the current child. A companion that is still starting, or whose page is
    // moving to the account's storefront, answers `not-ready`; that is not a failure of the call.
    const sendOnce = (request, deadline) => new Promise(resolve => {
        const instance = child;
        if (!instance?.connected) {
            resolve({ ok: false, error: 'runtime-unavailable' });
            return;
        }
        const budgetMs = Math.max(1, deadline - Date.now());
        const timer = setTimeout(() => {
            pending.delete(request.id);
            resolve({ ok: false, error: 'timeout' });
        }, budgetMs);
        pending.set(request.id, { resolve, timer });
        try {
            instance.send(request, error => {
                if (!error) return;
                const entry = pending.get(request.id);
                if (!entry) return;
                clearTimeout(entry.timer);
                pending.delete(request.id);
                resolve({ ok: false, error: 'disconnected' });
            });
        } catch {
            const entry = pending.get(request.id);
            if (entry) { clearTimeout(entry.timer); pending.delete(request.id); }
            resolve({ ok: false, error: 'runtime-unavailable' });
        }
    });

    return {
        async request(operation, params = {}) {
            const validated = validateRequest({ id: 'request_0', operation, params });
            if (!validated) return { ok: false, error: 'invalid-request' };
            // Login is the only visible surface; development follows the same background behavior.
            if (operation === 'hideWindow' && !child?.connected) return { ok: true, data: {} };
            if (pending.size >= 16) return { ok: false, error: 'busy' };
            const deadline = Date.now() + timeoutMs;
            let result = { ok: false, error: 'runtime-unavailable' };
            for (let attempt = 1; attempt <= 200; attempt++) {
                if (!start() || !child?.connected) {
                    return { ok: false, error: 'runtime-unavailable' };
                }
                result = await sendOnce({ ...validated, id: `request_${++sequence}_${attempt}` }, deadline);
                // The first request of a run is always early, and a storefront move makes the page
                // not-ready for a moment: ask again until this call's own time is up.
                if (result.error !== 'not-ready' || Date.now() >= deadline) return result;
                await new Promise(resolve => setTimeout(resolve, 250));
            }
            return result;
        },
        // Disconnecting the parent channel makes the companion exit and clears pending work.
        close() {
            const instance = child;
            child = null;
            failPending('disconnected');
            if (instance?.connected) instance.disconnect();
        },
    };
}

module.exports = { createCompanionClient };

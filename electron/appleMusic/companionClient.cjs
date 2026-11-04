'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const { validateRequest } = require('./companionRequests.cjs');

// Both hosts use a private parent-owned channel; neither opens a network listener.
function createCompanionClient({ nativeExecutablePath = '', profilePath, spawnProcess = spawn, createNativeChannel = require('./nativeSpawn.cjs').createNativeSpawn, timeoutMs = 25000 }) {
    const spawnNative = createNativeChannel({ spawnProcess });
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

    function start() {
        if (child?.connected) return true;
        if (!path.isAbsolute(nativeExecutablePath || '') || !path.isAbsolute(profilePath || '')) return false;
        const instance = spawnNative(nativeExecutablePath, [`--user-data-dir=${profilePath}`]);
        child = instance;
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
                if (Date.now() >= deadline) return result;
                if (!start() || !child?.connected) {
                    return { ok: false, error: 'runtime-unavailable' };
                }
                result = await sendOnce({ ...validated, id: `request_${++sequence}_${attempt}` }, deadline);
                // The first request of a run is always early, and a storefront move makes the page
                // not-ready for a moment: ask again until this call's own time is up.
                // `busy` is a rejection before execution, so retrying cannot duplicate a write.
                // Keep retries within this request's original deadline.
                if (!['not-ready', 'busy'].includes(result.error) || Date.now() >= deadline) {
                    const elapsedMs = Date.now() - (deadline - timeoutMs);
                    if (elapsedMs >= 1000) console.info('[AppleMusic] Companion request settled', { operation, elapsedMs, attempts: attempt, ok: result.ok });
                    return result;
                }
                await new Promise(resolve => setTimeout(resolve, Math.min(250, Math.max(0, deadline - Date.now()))));
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

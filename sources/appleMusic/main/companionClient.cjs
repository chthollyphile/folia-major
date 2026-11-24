'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const { validateRequest } = require('./companionRequests.cjs');

// How long a close waits for the companion to exit: past the native channel's 1.5 s kill fallback, inside the
// host's 3 s budget for onBeforeUnload.
const CLOSE_WAIT_MS = 2500;

// The page's word for a MusicKit error (its code, such as MEDIA_LICENSE), or null for anything else.
const playerErrorCode = value => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(value) ? value : null;

// Both hosts use a private parent-owned channel; neither opens a network listener.
// `onRunningChanged(running)` hears when a companion starts and when it goes (closed, exited or lost): the source's
// main entry holds the app's quit only while one runs.
function createCompanionClient({ nativeExecutablePath = '', profilePath, spawnProcess = spawn, createNativeChannel = require('./nativeSpawn.cjs').createNativeSpawn, timeoutMs = 25000, onRunningChanged = () => {} }) {
    const spawnNative = createNativeChannel({ spawnProcess });
    let child = null;
    let sequence = 0;
    const pending = new Map();
    // The player's state code last seen in a status answer: a change is logged once (single loop
    // goes round, or ends, by these codes), never every half-second answer.
    let lastPlayerState = null;
    // When MusicKit last reported an error, as the page stamped it: each one is logged once.
    let lastPlayerErrorAt = null;

    // Why MusicKit gave a track up, once per occurrence: a failed start (the page keeps answering
    // with it until the next start) or an error the player reported while a song went on.
    function logPlayerError(result) {
        const code = playerErrorCode(result.ok ? result.data?.playerError : result.playerError);
        if (!result.ok) {
            if (result.error !== 'playback-failed' || lastPlayerState === 'failed') return;
            lastPlayerState = 'failed';
            console.warn('[AppleMusic] start failed', { stage: result.playbackStage ?? null, playerError: code });
            return;
        }
        const at = result.data?.playerErrorAt;
        if (!code || !Number.isFinite(at) || at === lastPlayerErrorAt) return;
        lastPlayerErrorAt = at;
        console.warn('[AppleMusic] player error', { playerError: code });
    }

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
        onRunningChanged(true);
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
            onRunningChanged(false);
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
            // A new start: a failure of it is its own, logged even when the one before failed too.
            if (lastPlayerState === 'failed' && ['playSong', 'playStation', 'resume'].includes(operation)) lastPlayerState = null;
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
                    if (operation === 'setRepeatOne') {
                        console.info('[AppleMusic] single repeat', { asked: params.enabled === true, ok: result.ok, repeatMode: result.data?.repeatMode ?? null, error: result.error });
                    }
                    if (operation === 'playbackStatus' && result.ok && result.data && result.data.state !== lastPlayerState) {
                        lastPlayerState = result.data.state;
                        const { state, repeatMode, positionMs, durationMs, isPlaying } = result.data;
                        console.info('[AppleMusic] player state', { state, repeatMode, positionMs, durationMs, isPlaying });
                    }
                    if (operation === 'playbackStatus') logPlayerError(result);
                    const elapsedMs = Date.now() - (deadline - timeoutMs);
                    if (elapsedMs >= 1000) console.info('[AppleMusic] Companion request settled', { operation, elapsedMs, attempts: attempt, ok: result.ok });
                    return result;
                }
                await new Promise(resolve => setTimeout(resolve, Math.min(250, Math.max(0, deadline - Date.now()))));
            }
            return result;
        },
        // Pauses the player when the companion runs; a companion that does not run sounds nothing,
        // and asking it would start one. False when there was nothing to pause or the pause failed.
        async pauseIfRunning() {
            if (!child?.connected) return false;
            const result = await this.request('pause');
            return result.ok === true;
        },
        // Disconnecting the parent channel makes the companion exit and clears pending work. The promise settles
        // once the process has gone (its 'exit'), or after `waitMs` at most: until then WebView2 / WebKit may still
        // hold files in the profile folder, which a data clear right after removes.
        close({ waitMs = CLOSE_WAIT_MS } = {}) {
            const instance = child;
            child = null;
            failPending('disconnected');
            const gone = !instance || instance.exited === true ? Promise.resolve() : new Promise(resolve => {
                const timer = setTimeout(resolve, waitMs);
                timer.unref?.();
                instance.once('exit', () => { clearTimeout(timer); resolve(); });
            });
            if (instance?.connected) instance.disconnect();
            if (instance) onRunningChanged(false);
            return gone;
        },
    };
}

module.exports = { createCompanionClient };

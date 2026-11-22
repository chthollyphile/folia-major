'use strict';

// Serialized into the Apple page: prepare a bounded tail without replacing the sounding item.
async function controlQueue(mk, operation, params) {
    const idOf = item => item?.attributes?.playParams?.catalogId || item?.id || '';
    const currentId = idOf(mk.nowPlayingItem);
    const items = Array.isArray(mk.queue?.items) ? mk.queue.items : [];
    const position = Number.isInteger(mk.queue?.position) ? mk.queue.position : items.findIndex(item => idOf(item) === currentId);
    if (operation === 'prepareNext') {
        if (currentId !== params.catalogId) return { ok: false, error: currentId ? 'stale-request' : 'not-ready' };
        if (typeof mk.queue?.clearAfterCurrent !== 'function' || typeof mk.playLater !== 'function') return { ok: false, error: 'unsupported' };
        const tail = items.slice(position + 1).map(idOf);
        if (JSON.stringify(tail) !== JSON.stringify(params.nextIds)) {
            const extendsTail = tail.length <= params.nextIds.length && tail.every((id, index) => id === params.nextIds[index]);
            const appendIds = extendsTail ? params.nextIds.slice(tail.length) : params.nextIds;
            if (!extendsTail) await mk.queue.clearAfterCurrent();
            if (appendIds.length) await mk.playLater({ songs: appendIds });
        }
        if (idOf(mk.nowPlayingItem) !== params.catalogId) return { ok: false, error: 'stale-request' };
        window.__foliaPreparedQueue = [params.catalogId, ...params.nextIds];
        return { ok: true, data: {} };
    }
    const plan = window.__foliaPreparedQueue;
    const repeated = params.requestKey && window.__foliaLastPlay?.requestKey === params.requestKey
        && window.__foliaLastPlay.catalogId === params.catalogId;
    if (currentId === params.catalogId && params.startSec === 0 && (repeated || params.adoptCurrent === true)) {
        window.__foliaLastPlay = { requestKey: params.requestKey, catalogId: params.catalogId };
        return { ok: true, data: { reusedQueue: true, isPlaying: mk.isPlaying === true } };
    }
    // Only a successor may reuse playback. Clicking the current song again still means replay.
    if (params.startSec === 0 && Array.isArray(plan) && plan[0] !== params.catalogId && plan.includes(params.catalogId)) {
        const index = items.findIndex((item, index) => index >= position && idOf(item) === params.catalogId);
        if (index < 0) return null;
        if (currentId !== params.catalogId) {
            if (typeof mk.changeToMediaAtIndex !== 'function') return null;
            try {
                await mk.changeToMediaAtIndex(index);
            } catch {
                // A rejected optimized switch must not block the ordinary setQueue/play path.
                if (idOf(mk.nowPlayingItem) !== params.catalogId || mk.isPlaying !== true) {
                    window.__foliaPreparedQueue = [params.catalogId];
                    console.warn('[AppleMusic] Prepared switch rejected; loading the song normally');
                    return null;
                }
                // Some runtimes reject after starting the target; do not restart sounding audio.
            }
        }
        // changeToMediaAtIndex already starts playback; a second play() can restart its loading pipeline.
        // An already-current item may be paused by the user, which adoption must preserve.
        window.__foliaPreparedQueue = plan.slice(plan.indexOf(params.catalogId));
        window.__foliaLastPlay = { requestKey: params.requestKey, catalogId: params.catalogId };
        return { ok: true, data: { reusedQueue: true, isPlaying: mk.isPlaying === true } };
    }
    window.__foliaPreparedQueue = [params.catalogId];
    return null;
}

module.exports = { controlQueue };

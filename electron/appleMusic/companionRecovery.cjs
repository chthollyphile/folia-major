'use strict';

// Replace a stalled player document, preserving the session but destroying late playback work.
async function recoverPlaybackDocument(contents, invalidate, timeoutMs = 8000) {
    if (contents.isDestroyed()) return false;
    const url = contents.getURL();
    invalidate();
    let timer;
    try {
        await Promise.race([
            (async () => {
                await contents.loadURL('about:blank');
                await contents.loadURL(url);
            })(),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('Apple Music playback recovery timed out')), timeoutMs);
            }),
        ]);
        return !contents.isDestroyed();
    } catch (error) {
        // A failed navigation cannot guarantee silence. Destroy this renderer rather than reuse it.
        if (!contents.isDestroyed()) contents.close();
        console.warn('[AppleMusic] Player document could not be recovered', error);
        return false;
    } finally {
        clearTimeout(timer);
    }
}

module.exports = { recoverPlaybackDocument };

'use strict';

const { recoverPlaybackDocument } = require('./companionRecovery.cjs');

// Manage sign-out in the companion's own partition without leaving a live authenticated page.
function createSessionActions({ getWindow, getSession, invalidate, startUrl, recoverDocument = recoverPlaybackDocument }) {
    let signingOut = false;
    let recovering = false;
    return {
        isBusy: () => signingOut || recovering,
        isRecovering: () => recovering,
        // Navigation recovery and logout must never replace each other's documents.
        async recover(contents) {
            if (signingOut || recovering) return false;
            recovering = true;
            try {
                return await recoverDocument(contents, invalidate);
            } finally {
                recovering = false;
            }
        },
        async logout() {
            const window = getWindow();
            if (!window || window.isDestroyed()) return { ok: false, error: 'not-ready' };
            if (signingOut || recovering) return { ok: false, error: 'busy' };
            signingOut = true;
            invalidate();
            try {
                await window.loadURL('about:blank');
                await getSession().clearStorageData();
                if (window.isDestroyed()) return { ok: false, error: 'not-ready' };
                await window.loadURL(startUrl);
                return { ok: true, data: {} };
            } catch (error) {
                console.warn('[AppleMusic] Could not clear the companion session', error);
                return { ok: false, error: 'request-failed' };
            } finally {
                signingOut = false;
            }
        },
    };
}

module.exports = { createSessionActions };

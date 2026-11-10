'use strict';

// The Apple Music page has its own storefront (the region in its URL), and the account has the
// storefront Apple reports for it. MusicKit takes its storefront from the page, and a page in
// another region than the account's plays only previews (or refuses songs that region lacks).
// This decides whether the page has to move, and where to.
function storefrontTarget(currentUrl, storefront) {
    if (typeof storefront !== 'string' || !/^[a-z]{2}$/.test(storefront)) return null;
    try {
        const url = new URL(currentUrl);
        if (url.protocol !== 'https:' || url.hostname !== 'music.apple.com') return null;
        const current = url.pathname.split('/')[1];
        if (current === storefront) return null;
        return `https://music.apple.com/${storefront}/`;
    } catch {
        return null;
    }
}

// The region a music page is in, read from its address; null for anything else.
function pageStorefront(address) {
    try {
        const url = new URL(address);
        if (url.protocol !== 'https:' || url.hostname !== 'music.apple.com') return null;
        const region = url.pathname.split('/')[1];
        return /^[a-z]{2}$/.test(region) ? region : null;
    } catch {
        return null;
    }
}

// Runs inside the Apple page, before a start or a prepared queue. From a mainland address Apple
// redirects every page outside /cn back to /cn, so the page cannot always move to the account's
// region. Point MusicKit at the account's storefront in place instead, and lift the preview-only
// mode the web app chose for the other region when the account has a subscription.
async function alignStorefront(mk) {
    // The region Folia's catalog reads used (companionRequests.cjs), else the one MusicKit has.
    const read = window.__foliaStorefront?.data?.data?.[0]?.id;
    const account = typeof read === 'string' ? read : mk?.storefrontCountryCode;
    if (mk?.isAuthorized !== true || typeof account !== 'string' || !/^[a-z]{2}$/.test(account)) return;
    if (mk.storefrontId !== account) {
        mk.storefrontId = account;
        window.__foliaStorefrontAligned = true;
    }
    // A page already in the account's region keeps the playback mode the web app chose for it.
    if (window.__foliaStorefrontAligned !== true) return;
    const modes = window.MusicKit?.PlaybackMode;
    if (!modes || mk.playbackMode !== modes.PREVIEW_ONLY || typeof mk.hasMusicSubscription !== 'function') return;
    // One question at a time per page, and a late answer still counts for the next start. A start
    // waits for it three seconds at most, then plays the previews, as before.
    if (typeof window.__foliaSubscribed !== 'boolean') {
        window.__foliaSubscription ||= Promise.resolve().then(() => mk.hasMusicSubscription()).then(answer => {
            if (typeof answer === 'boolean') window.__foliaSubscribed = answer;
        }, () => {}).finally(() => { window.__foliaSubscription = null; });
        let timer;
        await Promise.race([window.__foliaSubscription, new Promise(done => { timer = setTimeout(done, 3000); })]);
        clearTimeout(timer);
    }
    if (window.__foliaSubscribed === true) mk.playbackMode = modes.MIXED_CONTENT;
}

module.exports = { storefrontTarget, pageStorefront, alignStorefront };

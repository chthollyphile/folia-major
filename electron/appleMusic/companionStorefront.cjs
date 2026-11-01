'use strict';

// The Apple Music page has its own storefront (the region in its URL), and the account has the
// storefront Apple reports for it. MusicKit plays a catalog id only against the page's storefront,
// so a page opened in another region accepts the queue and then does not play. This decides
// whether the page has to move, and where to.
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

module.exports = { storefrontTarget };

'use strict';

// Limit top-level navigation to Apple's music and sign-in hosts, including their subdomains.
// `account.apple.com` is the host Apple's current sign-in pages use; the two IDMS hosts serve the
// older forms. Extend this only from a real sign-in that needs another host.
const ALLOWED_HOSTS = ['music.apple.com', 'account.apple.com', 'appleid.apple.com', 'idmsa.apple.com'];

function isAllowedNavigation(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password && !url.port
            && ALLOWED_HOSTS.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
    } catch {
        return false;
    }
}

module.exports = { isAllowedNavigation };

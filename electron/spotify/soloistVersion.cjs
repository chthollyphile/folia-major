'use strict';
// Official build timestamps determine the 90-day lifetime and the 14-day reminder window.
const DAY_MS = 86400000;
function describeBuild(output, now = Date.now()) {
    const match = /^soloist\s+(\S+)\s+build\s+(\d{9,12})\b/m.exec(output);
    if (!match) return { state: 'unknown', version: null, daysRemaining: null };
    const builtAt = Number(match[2]) * 1000;
    const expiresAt = builtAt + 90 * DAY_MS;
    const daysRemaining = Math.max(0, Math.ceil((expiresAt - now) / DAY_MS));
    const state = builtAt > now + DAY_MS ? 'clock-warning' : expiresAt <= now ? 'expired' : daysRemaining <= 14 ? 'expiring' : 'valid';
    return { state, version: match[1], builtAt, expiresAt, daysRemaining };
}
module.exports = { describeBuild, DAY_MS };

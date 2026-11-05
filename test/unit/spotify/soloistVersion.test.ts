import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// Build lifetime is tied to the official build timestamp, including the exact expiry boundary.
const require = createRequire(import.meta.url);
const { describeBuild, DAY_MS } = require('../../../electron/spotify/soloistVersion.cjs');
const builtAt = Date.UTC(2026, 10, 5);
const output = `soloist 1.3.10.44 build ${builtAt / 1000} (20261105) (linux/x86_64)`;
describe('Soloist build lifetime', () => {
    it('expires 90 days after the build, regardless of installation', () => {
        expect(describeBuild(output, builtAt + 10 * DAY_MS)).toMatchObject({ state: 'valid', daysRemaining: 80, expiresAt: builtAt + 90 * DAY_MS });
    });
    it('starts reminders with 14 days left', () => {
        expect(describeBuild(output, builtAt + 75 * DAY_MS).state).toBe('valid');
        expect(describeBuild(output, builtAt + 76 * DAY_MS)).toMatchObject({ state: 'expiring', daysRemaining: 14 });
    });
    it('rejects a build at the exact expiration boundary', () => {
        expect(describeBuild(output, builtAt + 90 * DAY_MS)).toMatchObject({ state: 'expired', daysRemaining: 0 });
        expect(describeBuild(output, builtAt + 91 * DAY_MS).state).toBe('expired');
    });
    it('does not invent dates for an unknown version format', () => {
        expect(describeBuild('soloist future-version', builtAt)).toEqual({ state: 'unknown', version: null, daysRemaining: null });
    });
    it('identifies a clock older than the build', () => {
        expect(describeBuild(output, builtAt - 2 * DAY_MS).state).toBe('clock-warning');
    });
});

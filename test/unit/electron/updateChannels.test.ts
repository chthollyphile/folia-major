import { describe, expect, it } from 'vitest';

// test/unit/electron/updateChannels.test.ts

const {
    getReleaseUrl,
    getUpdateProviderConfig,
    resolveReleaseChannel,
} = require('../../../electron/updateChannels.cjs') as {
    getReleaseUrl: (channel: string | null, version: string, releasesUrl: string) => string;
    getUpdateProviderConfig: (
        releaseChannel: {
            updaterChannel: string | null;
            updateEnabled: boolean;
            rollingReleaseTag: string | null;
        },
        github: { owner: string; repo: string },
    ) => Record<string, unknown> | null;
    resolveReleaseChannel: (version: string, declaredChannel?: string | null) => {
        id: string;
        updaterChannel: string | null;
        allowPrerelease: boolean;
        updateEnabled: boolean;
    };
};

describe('release update channels', () => {
    it('uses packaged metadata before inferring a legacy version suffix', () => {
        expect(resolveReleaseChannel('0.7.0-beta.1', 'internal')).toMatchObject({
            id: 'internal',
            updaterChannel: null,
            updateEnabled: false,
        });
    });

    it.each([
        ['0.7.0', 'realeco', 'latest', false],
        ['0.7.0-beta.123', 'limo', 'beta', true],
        ['0.7.0-alpha.123', 'cielo', 'alpha', true],
    ])('maps %s to the %s lane', (version, id, updaterChannel, allowPrerelease) => {
        expect(resolveReleaseChannel(version)).toMatchObject({ id, updaterChannel, allowPrerelease });
    });

    it('opens rolling prereleases instead of manufacturing a semver tag', () => {
        const releasesUrl = 'https://github.com/chthollyphile/folia-major/releases';

        expect(getReleaseUrl('limo', '0.7.0-beta.123', releasesUrl)).toBe(`${releasesUrl}/tag/limo`);
        expect(getReleaseUrl('cielo', '0.7.0-alpha.123', releasesUrl)).toBe(`${releasesUrl}/tag/cielo`);
        expect(getReleaseUrl('realeco', '0.7.0', releasesUrl)).toBe(`${releasesUrl}/tag/v0.7.0`);
    });

    it('reads rolling prerelease metadata directly instead of using the GitHub release feed', () => {
        const github = { owner: 'chthollyphile', repo: 'folia-major' };

        expect(getUpdateProviderConfig(resolveReleaseChannel('0.7.0-beta.123', 'limo'), github)).toEqual({
            provider: 'generic',
            url: 'https://github.com/chthollyphile/folia-major/releases/download/limo/',
            channel: 'beta',
            useMultipleRangeRequest: false,
        });
        expect(getUpdateProviderConfig(resolveReleaseChannel('0.7.0-alpha.123', 'cielo'), github)).toEqual({
            provider: 'generic',
            url: 'https://github.com/chthollyphile/folia-major/releases/download/cielo/',
            channel: 'alpha',
            useMultipleRangeRequest: false,
        });
    });

    it('restores the GitHub provider after switching back to Realeco', () => {
        expect(getUpdateProviderConfig(
            resolveReleaseChannel('0.7.0', 'realeco'),
            { owner: 'chthollyphile', repo: 'folia-major' },
        )).toEqual({
            provider: 'github',
            owner: 'chthollyphile',
            repo: 'folia-major',
            channel: 'latest',
        });
    });
});

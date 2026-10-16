import { describe, expect, it } from 'vitest';

// test/unit/electron/obsLanAccess.test.ts
// Verifies listen-host selection, LAN address filtering, tokenized LAN URLs and the token-free
// public status served by the unauthenticated /obs/health endpoint.

const {
    resolveObsListenHost,
    listLanIpv4Addresses,
    buildObsLanUrls,
    buildPublicObsStatus,
} = require('../../../electron/obsLanAccess.cjs') as {
    resolveObsListenHost: (lanAccess: boolean) => string;
    listLanIpv4Addresses: (interfaces: Record<string, Array<Record<string, unknown>>>) => string[];
    buildObsLanUrls: (options: { addresses: string[]; port: number; token: string | null }) => string[];
    buildPublicObsStatus: (status: Record<string, unknown>) => Record<string, unknown>;
};

describe('obsLanAccess', () => {
    it('listens on loopback unless LAN access is on', () => {
        expect(resolveObsListenHost(false)).toBe('127.0.0.1');
        expect(resolveObsListenHost(true)).toBe('0.0.0.0');
    });

    it('keeps external IPv4 addresses, private ranges first, without duplicates', () => {
        const addresses = listLanIpv4Addresses({
            loopback: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
            ethernet: [
                { family: 'IPv6', address: 'fe80::1', internal: false },
                { family: 'IPv4', address: '203.0.113.7', internal: false },
                { family: 'IPv4', address: '192.168.1.10', internal: false },
            ],
            wifi: [
                { family: 4, address: '10.0.0.5', internal: false },
                { family: 'IPv4', address: '169.254.3.4', internal: false },
                { family: 'IPv4', address: '192.168.1.10', internal: false },
            ],
            docker: [{ family: 'IPv4', address: '172.20.0.1', internal: false }],
            other: [{ family: 'IPv4', address: '172.32.0.1', internal: false }],
        });

        expect(addresses).toEqual(['192.168.1.10', '10.0.0.5', '172.20.0.1', '203.0.113.7', '172.32.0.1']);
    });

    it('builds one tokenized URL per address and none without a token', () => {
        expect(buildObsLanUrls({ addresses: ['192.168.1.10'], port: 32108, token: 'a+b/c' })).toEqual([
            'http://192.168.1.10:32108/obs?obs=1&token=a%2Bb%2Fc',
        ]);
        expect(buildObsLanUrls({ addresses: ['192.168.1.10'], port: 32108, token: null })).toEqual([]);
    });

    it('drops the token and tokenized URLs from the public status', () => {
        const publicStatus = buildPublicObsStatus({
            enabled: true,
            port: 32108,
            token: 'secret',
            url: 'http://127.0.0.1:32108/obs?obs=1&token=secret',
            clientCount: 2,
            lanAccess: true,
            lanUrls: ['http://192.168.1.10:32108/obs?obs=1&token=secret'],
        });

        expect(publicStatus).toEqual({ enabled: true, port: 32108, lanAccess: true, clientCount: 2 });
        expect(JSON.stringify(publicStatus)).not.toContain('secret');
    });
});

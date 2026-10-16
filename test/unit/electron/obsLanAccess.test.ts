import { describe, expect, it } from 'vitest';

// test/unit/electron/obsLanAccess.test.ts
// Verifies listen-host selection, LAN address classification and ordering, tokenized LAN URLs and
// the token-free public status served by the unauthenticated /obs/health endpoint.

type LanAddress = { address: string; interfaceName: string; kind: string };

const {
    resolveObsListenHost,
    classifyLanAddress,
    listLanIpv4Addresses,
    buildObsLanEndpoints,
    buildPublicObsStatus,
} = require('../../../electron/obsLanAccess.cjs') as {
    resolveObsListenHost: (lanAccess: boolean) => string;
    classifyLanAddress: (address: string, interfaceName: string, mac?: string) => string;
    listLanIpv4Addresses: (interfaces: Record<string, Array<Record<string, unknown>>>) => LanAddress[];
    buildObsLanEndpoints: (options: { addresses: LanAddress[]; port: number; token: string | null }) => Array<LanAddress & { url: string }>;
    buildPublicObsStatus: (status: Record<string, unknown>) => Record<string, unknown>;
};

const ipv4 = (address: string, mac = '40:c2:ba:8f:25:5d', internal = false) => ({ family: 'IPv4', address, mac, internal });

describe('obsLanAccess', () => {
    it('listens on loopback unless LAN access is on', () => {
        expect(resolveObsListenHost(false)).toBe('127.0.0.1');
        expect(resolveObsListenHost(true)).toBe('0.0.0.0');
    });

    it('classifies physical, hotspot, virtual and public addresses', () => {
        expect(classifyLanAddress('10.14.60.71', '以太网', '40:c2:ba:8f:25:5d')).toBe('network');
        expect(classifyLanAddress('192.168.1.10', 'Wi-Fi')).toBe('network');
        expect(classifyLanAddress('192.168.137.1', '本地连接* 2', 'ee:4c:8c:28:4a:d3')).toBe('hotspot');
        expect(classifyLanAddress('172.20.96.1', 'vEthernet (WSL (Hyper-V firewall))')).toBe('virtual');
        expect(classifyLanAddress('100.64.0.2', 'Tailscale')).toBe('virtual');
        expect(classifyLanAddress('203.0.113.7', 'Ethernet 2')).toBe('public');
    });

    it('recognises virtual adapters with generic names by MAC prefix', () => {
        // TAP adapters (game accelerators, OpenVPN) are named like a normal connection on Windows.
        expect(classifyLanAddress('10.8.8.1', '本地连接', '00:ff:ec:d0:32:b5')).toBe('virtual');
        expect(classifyLanAddress('10.8.8.1', '以太网 2', '00-FF-DB-DF-5D-4C')).toBe('virtual');
        expect(classifyLanAddress('192.168.56.1', 'Ethernet 3', '0a:00:27:00:00:0c')).toBe('virtual');
    });

    it('puts the physical network first and virtual adapters last (a real Windows layout)', () => {
        const addresses = listLanIpv4Addresses({
            'vEthernet (WSL (Hyper-V firewall))': [ipv4('172.20.96.1', '00:15:5d:40:8a:1a')],
            '本地连接* 2': [ipv4('192.168.137.1', 'ee:4c:8c:28:4a:d3')],
            '本地连接': [ipv4('10.8.8.1', '00:ff:ec:d0:32:b5')],
            '以太网': [{ family: 'IPv6', address: 'fe80::1', internal: false }, ipv4('10.14.60.71')],
            'Loopback Pseudo-Interface 1': [ipv4('127.0.0.1', '00:00:00:00:00:00', true)],
        });

        expect(addresses).toEqual([
            { address: '10.14.60.71', interfaceName: '以太网', kind: 'network' },
            { address: '192.168.137.1', interfaceName: '本地连接* 2', kind: 'hotspot' },
            { address: '172.20.96.1', interfaceName: 'vEthernet (WSL (Hyper-V firewall))', kind: 'virtual' },
            { address: '10.8.8.1', interfaceName: '本地连接', kind: 'virtual' },
        ]);
    });

    it('drops link-local addresses, duplicates and non-IPv4 entries', () => {
        const addresses = listLanIpv4Addresses({
            wifi: [{ family: 4, address: '192.168.1.10', internal: false }, ipv4('169.254.3.4')],
            ethernet: [ipv4('192.168.1.10'), { family: 'IPv6', address: '::1', internal: false }],
        });

        expect(addresses).toEqual([{ address: '192.168.1.10', interfaceName: 'wifi', kind: 'network' }]);
    });

    it('builds one tokenized URL per address and none without a token', () => {
        const addresses = [{ address: '192.168.1.10', interfaceName: 'Wi-Fi', kind: 'network' }];
        expect(buildObsLanEndpoints({ addresses, port: 32108, token: 'a+b/c' })).toEqual([
            { address: '192.168.1.10', interfaceName: 'Wi-Fi', kind: 'network', url: 'http://192.168.1.10:32108/obs?obs=1&token=a%2Bb%2Fc' },
        ]);
        expect(buildObsLanEndpoints({ addresses, port: 32108, token: null })).toEqual([]);
    });

    it('drops the token and tokenized URLs from the public status', () => {
        const publicStatus = buildPublicObsStatus({
            enabled: true,
            port: 32108,
            token: 'secret',
            url: 'http://127.0.0.1:32108/obs?obs=1&token=secret',
            clientCount: 2,
            lanAccess: true,
            lanEndpoints: [{ address: '192.168.1.10', interfaceName: 'Wi-Fi', kind: 'network', url: 'http://192.168.1.10:32108/obs?obs=1&token=secret' }],
        });

        expect(publicStatus).toEqual({ enabled: true, port: 32108, lanAccess: true, clientCount: 2 });
        expect(JSON.stringify(publicStatus)).not.toContain('secret');
    });
});

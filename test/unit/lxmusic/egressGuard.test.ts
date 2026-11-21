import { describe, expect, it } from 'vitest';
import { addressBlockReason, hostnameBlockReason, parseIpv6 } from '../../../sources/lxmusic/main/egressGuard';

// test/unit/lxmusic/egressGuard.test.ts
// 洛雪音源受控出口的地址判定：本机、内网、链路本地、运营商 NAT、各种包着 IPv4 的 IPv6 写法都要拦，公网地址放行。

describe('addressBlockReason', () => {
    it.each([
        ['127.0.0.1', 'loopback'], ['127.255.255.254', 'loopback'], ['0.0.0.0', 'unspecified'], ['0.1.2.3', 'unspecified'],
        ['10.0.0.1', 'private'], ['172.16.0.1', 'private'], ['172.31.255.255', 'private'], ['192.168.1.1', 'private'],
        ['100.64.0.1', 'carrier-nat'], ['100.127.255.255', 'carrier-nat'],
        ['169.254.169.254', 'link-local'], ['192.0.0.8', 'reserved'], ['192.0.2.1', 'reserved'], ['198.51.100.7', 'reserved'],
        ['203.0.113.9', 'reserved'], ['224.0.0.1', 'multicast'], ['239.255.255.250', 'multicast'], ['240.0.0.1', 'reserved'],
        ['255.255.255.255', 'reserved'],
    ])('blocks IPv4 %s (%s)', (address, reason) => {
        expect(addressBlockReason(address)).toBe(reason);
    });

    it.each(['1.1.1.1', '8.8.8.8', '100.63.255.255', '100.128.0.1', '172.15.0.1', '172.32.0.1', '192.167.1.1', '169.253.1.1', '223.5.5.5'])(
        'lets the public IPv4 %s through', (address) => {
            expect(addressBlockReason(address)).toBeNull();
        },
    );

    it('lets 198.18.0.0/15 through: the fake-ip range of TUN proxies, which leads to no local machine', () => {
        expect(addressBlockReason('198.18.0.1')).toBeNull();
        expect(addressBlockReason('198.19.255.255')).toBeNull();
    });

    it.each([
        ['::1', 'loopback'], ['::', 'unspecified'], ['0:0:0:0:0:0:0:1', 'loopback'],
        ['::ffff:127.0.0.1', 'loopback'], ['::ffff:7f00:1', 'loopback'], ['::ffff:10.0.0.1', 'private'], ['::ffff:c0a8:101', 'private'],
        ['::ffff:100.64.0.1', 'carrier-nat'], ['::ffff:169.254.169.254', 'link-local'],
        ['::127.0.0.1', 'loopback'], ['::ffff:0:127.0.0.1', 'loopback'],
        ['64:ff9b::7f00:1', 'loopback'], ['64:ff9b::10.0.0.1', 'private'], ['64:ff9b:1::1', 'reserved'],
        ['2002:7f00:1::', 'loopback'], ['2002:c0a8:101::1', 'private'], ['2001::1', 'reserved'], ['2001:db8::1', 'reserved'],
        ['100::1', 'reserved'], ['fc00::1', 'private'], ['fd12:3456:789a::1', 'private'], ['fe80::1', 'link-local'],
        ['febf::1', 'link-local'], ['fec0::1', 'private'], ['ff02::1', 'multicast'],
        ['[::1]', 'loopback'],
    ])('blocks IPv6 %s (%s)', (address, reason) => {
        expect(addressBlockReason(address)).toBe(reason);
    });

    it.each(['2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8', '64:ff9b::808:808', '2002:808:808::1', '2400:3200::1'])(
        'lets the public IPv6 %s through', (address) => {
            expect(addressBlockReason(address)).toBeNull();
        },
    );

    it('refuses what is not an address, and an address with a zone', () => {
        expect(addressBlockReason('fe80::1%eth0')).toBe('invalid-address');
        expect(addressBlockReason('example.com')).toBe('invalid-address');
        expect(addressBlockReason('1.2.3')).toBe('invalid-address');
        expect(addressBlockReason('')).toBe('invalid-address');
    });

    it('reads the sixteen bytes of an IPv6 address', () => {
        expect(parseIpv6('::ffff:1.2.3.4')).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 1, 2, 3, 4]);
        expect(parseIpv6('1:2:3:4:5:6:7:8')).toEqual([0, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 6, 0, 7, 0, 8]);
        expect(parseIpv6('1:2:3:4:5:6:1.2.3.4')).toEqual([0, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 6, 1, 2, 3, 4]);
        expect(parseIpv6('1:2:3:4:5:6:7')).toBeNull();
        expect(parseIpv6('1::2::3')).toBeNull();
        expect(parseIpv6('1:2:3:4:5:6:7:8:9')).toBeNull();
        expect(parseIpv6('12345::')).toBeNull();
    });
});

describe('hostnameBlockReason', () => {
    it.each(['localhost', 'LOCALHOST', 'localhost.', 'foo.localhost', 'printer.local', 'nas.lan', 'db.internal', 'x.home.arpa', 'router', 'intranet'])(
        'blocks the local name %s before it is resolved', (name) => {
            expect(hostnameBlockReason(name)).toBe('local-name');
        },
    );

    it('judges an address written as the host name by the address', () => {
        expect(hostnameBlockReason('127.0.0.1')).toBe('loopback');
        expect(hostnameBlockReason('[::1]')).toBe('loopback');
        expect(hostnameBlockReason('[::ffff:192.168.0.1]')).toBe('private');
        expect(hostnameBlockReason('8.8.8.8')).toBeNull();
    });

    it('leaves the odd spellings of an IPv4 address to the URL parser, which turns them into dotted decimals', () => {
        for (const spelling of ['http://2130706433/', 'http://0x7f.1/', 'http://0177.0.0.1/', 'http://127.1/']) {
            expect(hostnameBlockReason(new URL(spelling).hostname), spelling).toBe('loopback');
        }
        expect(hostnameBlockReason(new URL('http://[0:0:0:0:0:ffff:7f00:1]/').hostname)).toBe('loopback');
    });

    it('lets an ordinary name through to be resolved', () => {
        expect(hostnameBlockReason('example.com')).toBeNull();
        expect(hostnameBlockReason('music.example.co.uk')).toBeNull();
    });
});

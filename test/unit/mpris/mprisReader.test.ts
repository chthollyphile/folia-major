import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

// 钉住系统媒体会话的轮询：排除 Folia 自己登记的总线名、把每个播放器的 GetAll 整理成快照、
// 某个播放器取不到时跳过它、总线出错后下一轮重连、stop 之后不再推。

const require = createRequire(import.meta.url);
const { createMprisReader } = require('../../../electron/mpris/mprisReader.cjs') as {
    createMprisReader: (options: Record<string, unknown>) => {
        start: () => void;
        stop: () => void;
        isRunning: () => boolean;
    };
};

type Variant = { signature: string; value: unknown };
const variant = (signature: string, value: unknown): Variant => ({ signature, value });

const playerEntries = (title: string) => [
    ['PlaybackStatus', variant('s', 'Playing')],
    ['Position', variant('x', 10_000_000n)],
    ['Rate', variant('d', 1)],
    ['Metadata', variant('a{sv}', [
        ['mpris:trackid', variant('o', '/track/1')],
        ['mpris:length', variant('x', 200_000_000n)],
        ['xesam:title', variant('s', title)],
        ['xesam:artist', variant('as', ['歌手'])],
    ])],
];

const createFakeBus = ({ names, failListOnce = false }: { names: string[]; failListOnce?: boolean }) => {
    let closed = false;
    let listCalls = 0;
    const bus = {
        isClosed: () => closed,
        close: () => { closed = true; },
        call: async ({ member, body }: { member: string; body?: unknown[] }) => {
            if (member === 'ListNames') {
                listCalls += 1;
                if (failListOnce && listCalls === 1) throw new Error('bus is not ready');
                return { signature: 'as', body: [names] };
            }
            if (member === 'GetAll') {
                if (body?.[0] === 'org.mpris.MediaPlayer2') return { signature: 'a{sv}', body: [[['Identity', variant('s', 'Player A')]]] };
                return { signature: 'a{sv}', body: [playerEntries('第一首')] };
            }
            throw new Error(`unexpected call ${member}`);
        },
    };
    return bus;
};

describe('createMprisReader', () => {
    it('reads the players on the bus and skips Folia itself', async () => {
        const bus = createFakeBus({
            names: [
                'org.mpris.MediaPlayer2.a',
                'org.mpris.MediaPlayer2.folia',
                'org.mpris.MediaPlayer2.folia.instance4242',
                'org.mpris.MediaPlayer2.foliatest',
                // Chromium 的 MPRIS 用自己的主进程 pid；同一台机器上另一个 Chromium 窗口要被当成别的播放器。
                'org.mpris.MediaPlayer2.chromium.instance4242',
                'org.mpris.MediaPlayer2.chromium.instance9999',
                'org.freedesktop.DBus',
            ],
        });
        const snapshot = await new Promise<Record<string, unknown>>(resolve => {
            const reader = createMprisReader({ connect: async () => bus, intervalMs: 10_000, ownPid: 4242, onSnapshot: resolve });
            reader.start();
        });
        const players = snapshot.players as Array<Record<string, unknown>>;
        expect(players.map(player => player.busName)).toEqual([
            'org.mpris.MediaPlayer2.a',
            'org.mpris.MediaPlayer2.chromium.instance9999',
            'org.mpris.MediaPlayer2.foliatest',
        ]);
        expect(players[0].identity).toBe('Player A');
        expect(players[0].title).toBe('第一首');
        expect(players.map(player => player.busName)).toContain(snapshot.activeBusName);
    });

    it('reports listening, reconnects after a failed poll, and stops pushing after stop', async () => {
        const bus = createFakeBus({ names: ['org.mpris.MediaPlayer2.a'], failListOnce: true });
        const statuses: Array<{ listening: boolean; error: string | null }> = [];
        const snapshots: Array<Record<string, unknown>> = [];
        const reader = createMprisReader({
            connect: async () => bus,
            intervalMs: 10,
            onStatus: (status: { listening: boolean; error: string | null }) => statuses.push(status),
            onSnapshot: (snapshot: Record<string, unknown>) => snapshots.push(snapshot),
        });
        reader.start();
        await vi.waitFor(() => expect(snapshots.length).toBeGreaterThan(0), { timeout: 2_000 });
        // 第一次连不上也要报出去，否则界面一直停在「正在读取」。
        expect(statuses.some(status => status.listening === false && status.error === 'bus is not ready')).toBe(true);
        expect(statuses.some(status => status.listening === true)).toBe(true);

        reader.stop();
        expect(reader.isRunning()).toBe(false);
        const countAfterStop = snapshots.length;
        await new Promise(resolve => setTimeout(resolve, 40));
        expect(snapshots.length).toBe(countAfterStop);
        expect(bus.isClosed()).toBe(true);
    });

    it('resends the current status when the reader is started again for a new window', async () => {
        const bus = createFakeBus({ names: ['org.mpris.MediaPlayer2.a'] });
        const statuses: Array<{ listening: boolean; error: string | null }> = [];
        const reader = createMprisReader({
            connect: async () => bus,
            intervalMs: 10,
            onStatus: (status: { listening: boolean; error: string | null }) => statuses.push(status),
            onSnapshot: () => undefined,
        });
        reader.start();
        await vi.waitFor(() => expect(statuses).toContainEqual({ listening: true, error: null }), { timeout: 2_000 });
        const before = statuses.length;
        reader.start();
        expect(statuses).toHaveLength(before + 1);
        expect(statuses[statuses.length - 1]).toEqual({ listening: true, error: null });
        reader.stop();
    });
});

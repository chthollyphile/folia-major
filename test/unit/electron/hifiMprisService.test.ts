import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 钉住 MPRIS 对象（#835 的修法：Linux 上 HiFi 的系统媒体控制由主进程登记，不再靠页面里挡住 PipeWire 切采样率的保活）：
// 属性就位后才要总线名、名字被占时加 .instance<pid>、只为变了的属性发 PropertiesChanged、跳转发 Seeked、
// 位置在放时往后外推、离开 HiFi 交还名字；Properties / Introspect / Peer 的应答；按键交给渲染进程；连不上时隔一阵再试，
// 断了一小会儿就重连，都不等下一次推送；登记成没成报给渲染进程。

const require = createRequire(import.meta.url);
const mpris = require('../../../electron/hifi/mpris/mprisService.cjs') as {
    NO_TRACK_PATH: string;
    trackIdPath: (trackKey: string) => string;
    currentPositionSec: (state: Record<string, unknown>, nowMs: number) => number;
    createMprisService: (options: Record<string, unknown>) => {
        update: (state: Record<string, unknown>) => void;
        setArtwork: (trackKey: string, url: string | null) => void;
        currentTrackKey: () => string | null;
        dispose: () => void;
    };
};
const { DbusError } = require('../../../electron/hifi/mpris/dbusConnection.cjs') as {
    DbusError: new (name: string, message?: string) => Error & { dbusName: string };
};

type Variant = { signature: string; value: unknown };
type Call = { member: string; signature?: string; body?: unknown[] };
type Signal = { path: string; interface: string; member: string; signature: string; body: unknown[] };

const createFakeConnection = ({ taken = [] as string[] } = {}) => {
    const calls: Call[] = [];
    const signals: Signal[] = [];
    const owned = new Set<string>();
    let handler: ((message: Record<string, unknown>) => unknown) | null = null;
    let closeHandler: ((error: Error | null) => void) | null = null;
    let closed = false;
    return {
        calls,
        signals,
        owned,
        uniqueName: ':1.9',
        call: vi.fn(async (message: Call) => {
            calls.push({ member: message.member, signature: message.signature, body: message.body });
            if (message.member === 'RequestName') {
                const name = message.body![0] as string;
                if (taken.includes(name)) return { signature: 'u', body: [3] };
                owned.add(name);
                return { signature: 'u', body: [1] };
            }
            if (message.member === 'ReleaseName') {
                owned.delete(message.body![0] as string);
                return { signature: 'u', body: [1] };
            }
            return { signature: '', body: [] };
        }),
        emitSignal: vi.fn((signal: Signal) => { signals.push(signal); }),
        onMethodCall: (next: typeof handler) => { handler = next; },
        onClose: (next: typeof closeHandler) => { closeHandler = next; },
        isClosed: () => closed,
        close: vi.fn(() => { closed = true; }),
        /** 像总线那样调进来一个方法。 */
        invoke: async (iface: string | null, member: string, signature = '', body: unknown[] = []) => (
            handler!({ path: '/org/mpris/MediaPlayer2', interface: iface ?? undefined, member, signature, body })
        ),
        drop: () => {
            closed = true;
            closeHandler?.(new Error('gone'));
        },
    };
};

const flush = async () => {
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
};

const playing = (overrides: Record<string, unknown> = {}) => ({
    active: true,
    trackKey: 'local:1#a',
    title: '晴天',
    artists: ['周杰伦'],
    album: '叶惠美',
    durationSec: 269.5,
    status: 'Playing',
    positionSec: 10,
    atMs: 1000,
    seeked: false,
    ...overrides,
});

let nowMs = 1000;
let onCommand: ReturnType<typeof vi.fn>;
let onRaise: ReturnType<typeof vi.fn>;

beforeEach(() => {
    nowMs = 1000;
    onCommand = vi.fn();
    onRaise = vi.fn();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

const startService = (connection = createFakeConnection(), extra: Record<string, unknown> = {}) => {
    const connect = vi.fn(async () => connection);
    const service = mpris.createMprisService({ connect, onCommand, onRaise, now: () => nowMs, pid: 4242, readMachineId: () => 'abc', ...extra });
    return { service, connection, connect };
};

const getProperty = async (connection: ReturnType<typeof createFakeConnection>, iface: string, name: string) => (
    ((await connection.invoke('org.freedesktop.DBus.Properties', 'Get', 'ss', [iface, name])) as { body: Variant[] }).body[0]
);
const metadataOf = (variantValue: Variant) => Object.fromEntries((variantValue.value as Array<[string, Variant]>).map(([key, value]) => [key, value.value]));

describe('createMprisService', () => {
    it('stays off the bus until HiFi plays, then owns org.mpris.MediaPlayer2.folia with the properties in place', async () => {
        const { service, connection, connect } = startService();
        service.update({ active: false });
        await flush();
        expect(connect).not.toHaveBeenCalled();

        service.update(playing());
        await flush();
        expect(connection.owned).toEqual(new Set(['org.mpris.MediaPlayer2.folia']));
        expect(connection.calls[0]).toEqual({ member: 'RequestName', signature: 'su', body: ['org.mpris.MediaPlayer2.folia', 4] });
        // The first owner read sees the track right away; no PropertiesChanged for the start.
        expect(connection.signals).toEqual([]);
        expect(await getProperty(connection, 'org.mpris.MediaPlayer2.Player', 'PlaybackStatus')).toEqual({ signature: 's', value: 'Playing' });
        expect(metadataOf(await getProperty(connection, 'org.mpris.MediaPlayer2.Player', 'Metadata'))).toEqual({
            'mpris:trackid': mpris.trackIdPath('local:1#a'),
            'mpris:length': 269500000n,
            'xesam:title': '晴天',
            'xesam:artist': ['周杰伦'],
            'xesam:album': '叶惠美',
        });
    });

    it('takes .instance<pid> when another Folia owns the plain name', async () => {
        const { service, connection } = startService(createFakeConnection({ taken: ['org.mpris.MediaPlayer2.folia'] }));
        service.update(playing());
        await flush();
        expect(connection.owned).toEqual(new Set(['org.mpris.MediaPlayer2.folia.instance4242']));
    });

    it('signals only what changed, never Position, and Seeked after a seek', async () => {
        const { service, connection } = startService();
        service.update(playing());
        await flush();

        nowMs = 3000;
        service.update(playing({ positionSec: 12, atMs: 3000 }));
        await flush();
        expect(connection.signals).toEqual([]);

        service.update(playing({ status: 'Paused', positionSec: 42, atMs: 3000, seeked: true }));
        await flush();
        expect(connection.signals.map(signal => signal.member)).toEqual(['PropertiesChanged', 'Seeked']);
        const [iface, changed, invalidated] = connection.signals[0].body as [string, Array<[string, Variant]>, string[]];
        expect(iface).toBe('org.mpris.MediaPlayer2.Player');
        expect(changed).toEqual([['PlaybackStatus', { signature: 's', value: 'Paused' }]]);
        expect(invalidated).toEqual([]);
        expect(connection.signals[1]).toMatchObject({ interface: 'org.mpris.MediaPlayer2.Player', signature: 'x', body: [42000000n] });

        service.update(playing({ trackKey: 'local:2#b', title: '七里香', status: 'Paused', positionSec: 0, atMs: 3000 }));
        await flush();
        const [, nextChanged] = connection.signals[2].body as [string, Array<[string, Variant]>];
        expect(nextChanged.map(([name]) => name)).toEqual(['Metadata']);
        expect(metadataOf(nextChanged[0][1])['xesam:title']).toBe('七里香');
    });

    it('adds the cover of the current track only', async () => {
        const { service, connection } = startService();
        service.update(playing());
        await flush();
        service.setArtwork('local:other#x', 'file:///tmp/a.png');
        await flush();
        expect(connection.signals).toEqual([]);
        service.setArtwork('local:1#a', 'file:///tmp/b.png');
        await flush();
        const [, changed] = connection.signals[0].body as [string, Array<[string, Variant]>];
        expect(metadataOf(changed[0][1])['mpris:artUrl']).toBe('file:///tmp/b.png');
    });

    it('extrapolates Position while playing, holds it while paused, never past the end', async () => {
        const { service, connection } = startService();
        service.update(playing({ positionSec: 10, atMs: 1000 }));
        await flush();
        nowMs = 3500;
        expect(await getProperty(connection, 'org.mpris.MediaPlayer2.Player', 'Position')).toEqual({ signature: 'x', value: 12500000n });
        expect(mpris.currentPositionSec(playing({ status: 'Paused' }), 99999)).toBe(10);
        expect(mpris.currentPositionSec(playing({ positionSec: 269 }), 1000 + 60000)).toBe(269.5);
    });

    it('releases the name when HiFi stops, and owns it again on the next play', async () => {
        const { service, connection } = startService();
        service.update(playing());
        await flush();
        service.update({ active: false });
        await flush();
        expect(connection.owned.size).toBe(0);
        expect(connection.calls.at(-1)).toEqual({ member: 'ReleaseName', signature: 's', body: ['org.mpris.MediaPlayer2.folia'] });
        service.update(playing());
        await flush();
        expect(connection.owned.size).toBe(1);
    });

    it('hands the media keys to the page while active, raises the window, and ignores seeks and rate or volume writes', async () => {
        const { service, connection } = startService();
        service.update(playing());
        await flush();
        for (const member of ['Play', 'Pause', 'PlayPause', 'Stop', 'Next', 'Previous']) {
            await connection.invoke('org.mpris.MediaPlayer2.Player', member);
        }
        expect(onCommand.mock.calls.map(([command]) => command)).toEqual(['play', 'pause', 'playpause', 'stop', 'next', 'previous']);
        await connection.invoke('org.mpris.MediaPlayer2.Player', 'Seek', 'x', [5000000n]);
        await connection.invoke('org.mpris.MediaPlayer2', 'Raise');
        expect(onRaise).toHaveBeenCalledTimes(1);
        await expect(connection.invoke('org.freedesktop.DBus.Properties', 'Set', 'ssv', ['org.mpris.MediaPlayer2.Player', 'Volume', { signature: 'd', value: 0.5 }])).resolves.toEqual({});
        await expect(connection.invoke('org.freedesktop.DBus.Properties', 'Set', 'ssv', ['org.mpris.MediaPlayer2.Player', 'PlaybackStatus', { signature: 's', value: 'x' }]))
            .rejects.toMatchObject({ dbusName: 'org.freedesktop.DBus.Error.PropertyReadOnly' });
        await expect(connection.invoke('org.mpris.MediaPlayer2.Player', 'OpenUri', 's', ['file:///x'])).rejects.toBeInstanceOf(DbusError);
        expect(onCommand).toHaveBeenCalledTimes(6);

        service.update({ active: false });
        await flush();
        await connection.invoke('org.mpris.MediaPlayer2.Player', 'Play');
        expect(onCommand).toHaveBeenCalledTimes(6);
    });

    it('answers Properties.GetAll, Introspect and Peer, and errors on unknown names', async () => {
        const { service, connection } = startService();
        service.update(playing());
        await flush();
        const root = (await connection.invoke('org.freedesktop.DBus.Properties', 'GetAll', 's', ['org.mpris.MediaPlayer2'])) as { signature: string; body: [Array<[string, Variant]>] };
        expect(root.signature).toBe('a{sv}');
        expect(Object.fromEntries(root.body[0].map(([key, value]) => [key, value.value]))).toEqual({
            CanQuit: false,
            CanRaise: true,
            HasTrackList: false,
            Identity: 'Folia',
            DesktopEntry: 'folia-major',
            SupportedUriSchemes: [],
            SupportedMimeTypes: [],
        });
        const player = (await connection.invoke('org.freedesktop.DBus.Properties', 'GetAll', 's', ['org.mpris.MediaPlayer2.Player'])) as { body: [Array<[string, Variant]>] };
        expect(Object.fromEntries(player.body[0].map(([key, value]) => [key, value.value]))).toMatchObject({
            CanControl: true, CanPlay: true, CanPause: true, CanGoNext: true, CanGoPrevious: true, CanSeek: false, Rate: 1, Volume: 1,
        });
        const xml = (await connection.invoke('org.freedesktop.DBus.Introspectable', 'Introspect')) as { body: string[] };
        expect(xml.body[0]).toContain('<interface name="org.mpris.MediaPlayer2.Player">');
        await expect(connection.invoke('org.freedesktop.DBus.Peer', 'GetMachineId')).resolves.toEqual({ signature: 's', body: ['abc'] });
        await expect(connection.invoke('org.freedesktop.DBus.Properties', 'Get', 'ss', ['org.mpris.MediaPlayer2.Player', 'Nope']))
            .rejects.toMatchObject({ dbusName: 'org.freedesktop.DBus.Error.UnknownProperty' });
        await expect(connection.invoke('org.example.Nope', 'Get')).rejects.toMatchObject({ dbusName: 'org.freedesktop.DBus.Error.UnknownInterface' });
    });

    it('describes no track while inactive', async () => {
        const { service, connection } = startService();
        service.update(playing());
        await flush();
        service.update({ active: false });
        await flush();
        expect(await getProperty(connection, 'org.mpris.MediaPlayer2.Player', 'PlaybackStatus')).toEqual({ signature: 's', value: 'Stopped' });
        expect(metadataOf(await getProperty(connection, 'org.mpris.MediaPlayer2.Player', 'Metadata'))).toEqual({ 'mpris:trackid': mpris.NO_TRACK_PATH });
    });

    it('waits 30 s before trying a bus it could not reach again, and reconnects after the bus drops', async () => {
        const connection = createFakeConnection();
        const connect = vi.fn()
            .mockRejectedValueOnce(new Error('no bus'))
            .mockResolvedValue(connection);
        const service = mpris.createMprisService({ connect, onCommand, onRaise, now: () => nowMs, pid: 1 });
        service.update(playing());
        await flush();
        expect(connect).toHaveBeenCalledTimes(1);
        nowMs += 10000;
        service.update(playing({ atMs: nowMs }));
        await flush();
        expect(connect).toHaveBeenCalledTimes(1);
        nowMs += 30000;
        service.update(playing({ atMs: nowMs }));
        await flush();
        expect(connect).toHaveBeenCalledTimes(2);
        expect(connection.owned.size).toBe(1);

        connection.drop();
        connection.owned.clear();
        const replacement = createFakeConnection();
        connect.mockResolvedValue(replacement);
        service.update(playing({ atMs: nowMs }));
        await flush();
        expect(replacement.owned.size).toBe(1);
        service.dispose();
        expect(replacement.close).toHaveBeenCalled();
    });

    it('retries on its own timer while HiFi plays, reconnects soon after a drop, and reports whether it is registered', async () => {
        const timers: Array<{ run: () => void; delayMs: number }> = [];
        const setTimer = vi.fn((run: () => void, delayMs: number) => { timers.push({ run, delayMs }); return timers.length; });
        const clearTimer = vi.fn();
        const onRegistered = vi.fn();
        const connection = createFakeConnection();
        const connect = vi.fn()
            .mockRejectedValueOnce(new Error('no bus'))
            .mockResolvedValue(connection);
        const service = mpris.createMprisService({ connect, onCommand, onRaise, onRegistered, now: () => nowMs, pid: 1, setTimer, clearTimer });
        service.update(playing());
        await flush();
        expect(onRegistered).toHaveBeenLastCalledWith(false);
        expect(timers.map(timer => timer.delayMs)).toEqual([30000]);

        // No push comes in: the timer alone brings MPRIS up.
        nowMs += 30000;
        timers.shift()!.run();
        await flush();
        expect(connect).toHaveBeenCalledTimes(2);
        expect(connection.owned.size).toBe(1);
        expect(onRegistered).toHaveBeenLastCalledWith(true);

        const replacement = createFakeConnection();
        connect.mockResolvedValue(replacement);
        connection.drop();
        expect(onRegistered).toHaveBeenLastCalledWith(false);
        expect(timers.map(timer => timer.delayMs)).toEqual([1000]);
        timers.shift()!.run();
        await flush();
        expect(replacement.owned.size).toBe(1);
        expect(onRegistered).toHaveBeenLastCalledWith(true);

        // Off the HiFi route a drop schedules nothing.
        service.update({ active: false });
        await flush();
        replacement.drop();
        expect(timers).toHaveLength(0);
        service.dispose();
    });
});

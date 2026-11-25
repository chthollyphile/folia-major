'use strict';

const { connectBus } = require('../hifi/mpris/dbusConnection.cjs');
const { sessionBusAddress } = require('../hifi/mpris/dbusWire.cjs');
const { buildPlayerSnapshot, pickActiveBusName, propertiesToObject, MAX_PLAYERS } = require('./mprisMetadata.cjs');

// 每秒读一遍会话总线上的播放器，推快照给渲染进程。不订阅 PropertiesChanged：各家信号实现差异大，轮询够用。
// D-Bus 客户端复用 HiFi 那套（electron/hifi/mpris/dbusConnection.cjs）。

const PLAYER_PREFIX = 'org.mpris.MediaPlayer2.';
// 排除 Folia 自己登记的 MPRIS：HiFi 是 ...MediaPlayer2.folia[.instance<pid>]，
// 普通路线是 ...chromium.instance<主进程 pid>。
const OWN_FOLIA_BUS = /^org\.mpris\.MediaPlayer2\.folia(?:\.instance\d+)?$/;
const OWN_CHROMIUM_BUS = pid => new RegExp(`^org\\.mpris\\.MediaPlayer2\\.(?:chromium|electron)\\.instance${pid}$`);
const DEFAULT_INTERVAL_MS = 1000;
const CALL_TIMEOUT_MS = 2000;

const isPlayerBusName = (name, ownPid = process.pid) => (
    typeof name === 'string'
    && name.startsWith(PLAYER_PREFIX)
    && name.length > PLAYER_PREFIX.length
    && !OWN_FOLIA_BUS.test(name)
    && !OWN_CHROMIUM_BUS(ownPid).test(name)
);

/** onSnapshot 收 { players, activeBusName, sampledAtMs }，onStatus 收 { listening, error }；connect 可注入。 */
const createMprisReader = ({
    onSnapshot,
    onStatus,
    intervalMs = DEFAULT_INTERVAL_MS,
    env = process.env,
    uid = process.getuid(),
    ownPid = process.pid,
    connect = () => connectBus({ address: sessionBusAddress(env), uid }),
}) => {
    let connection = null;
    let timer = null;
    let stopped = true;
    let polling = false;
    let lastErrorLog = null;
    // 同样的状态不重复发；新窗口 start 时补发。
    let status = { listening: false, error: null };
    const identities = new Map();
    const previous = new Map();

    const report = (listening, error = null) => {
        if (status.listening === listening && status.error === error) return;
        status = { listening, error };
        onStatus?.(status);
    };
    const resendStatus = () => onStatus?.({ ...status });

    const ensureConnection = async () => {
        if (connection && !connection.isClosed()) return connection;
        if (sessionBusAddress(env) === null) throw new Error('No session bus address');
        connection = await connect();
        return connection;
    };

    const dropConnection = () => {
        try {
            connection?.close();
        } catch {
            // 已经断了。
        }
        connection = null;
        identities.clear();
    };

    const listPlayerNames = async bus => {
        const reply = await bus.call({
            destination: 'org.freedesktop.DBus',
            path: '/org/freedesktop/DBus',
            interface: 'org.freedesktop.DBus',
            member: 'ListNames',
            timeoutMs: CALL_TIMEOUT_MS,
        });
        const names = Array.isArray(reply.body[0]) ? reply.body[0] : [];
        return names.filter(name => isPlayerBusName(name, ownPid)).sort().slice(0, MAX_PLAYERS);
    };

    const getAll = async (bus, busName, iface) => {
        const reply = await bus.call({
            destination: busName,
            path: '/org/mpris/MediaPlayer2',
            interface: 'org.freedesktop.DBus.Properties',
            member: 'GetAll',
            signature: 's',
            body: [iface],
            timeoutMs: CALL_TIMEOUT_MS,
        });
        return propertiesToObject(reply.body[0]);
    };

    const readIdentity = async (bus, busName) => {
        if (identities.has(busName)) return identities.get(busName);
        let identity = '';
        try {
            identity = (await getAll(bus, busName, 'org.mpris.MediaPlayer2')).Identity ?? '';
        } catch {
            // 有些播放器没有 Root 接口，用总线名。
        }
        identities.set(busName, identity);
        return identity;
    };

    const readPlayer = async (bus, busName) => {
        const properties = await getAll(bus, busName, 'org.mpris.MediaPlayer2.Player');
        const identity = await readIdentity(bus, busName);
        const nowMs = Date.now();
        return buildPlayerSnapshot({
            busName,
            identity,
            properties,
            previous: previous.get(busName),
            nowMs,
        });
    };

    const poll = async () => {
        if (stopped || polling) return;
        polling = true;
        try {
            const bus = await ensureConnection();
            const names = await listPlayerNames(bus);
            const players = [];
            for (const busName of names) {
                try {
                    const player = await readPlayer(bus, busName);
                    previous.set(busName, player);
                    players.push(player);
                } catch {
                    // 可能刚退出，下一轮再看。
                    previous.delete(busName);
                }
            }
            for (const busName of [...previous.keys()]) {
                if (!players.some(player => player.busName === busName)) previous.delete(busName);
            }
            for (const busName of [...identities.keys()]) {
                if (!players.some(player => player.busName === busName)) identities.delete(busName);
            }
            if (stopped) return;
            lastErrorLog = null;
            report(true);
            onSnapshot({
                players: players.sort((left, right) => left.busName.localeCompare(right.busName)),
                activeBusName: pickActiveBusName(players),
                sampledAtMs: Date.now(),
            });
        } catch (error) {
            dropConnection();
            const message = error instanceof Error ? error.message : String(error);
            report(false, message);
            // 没有总线时每秒都失败，同一句只记一次。
            if (message !== lastErrorLog) {
                lastErrorLog = message;
                console.warn('[MPRIS] could not read the session bus', error);
            }
        } finally {
            polling = false;
        }
    };

    const start = () => {
        if (!stopped) {
            // 窗口重建后新页面会再 start 一次，补发当前状态。
            resendStatus();
            return;
        }
        stopped = false;
        void poll();
        timer = setInterval(() => void poll(), intervalMs);
        timer.unref?.();
    };

    const stop = () => {
        stopped = true;
        if (timer !== null) {
            clearInterval(timer);
            timer = null;
        }
        dropConnection();
        previous.clear();
        status = { listening: false, error: null };
        onStatus?.(status);
    };

    return { start, stop, isRunning: () => !stopped };
};

module.exports = {
    OWN_FOLIA_BUS,
    DEFAULT_INTERVAL_MS,
    isPlayerBusName,
    createMprisReader,
};

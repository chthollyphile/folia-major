'use strict';

const { connectBus } = require('../hifi/mpris/dbusConnection.cjs');

// electron/dux/mprisClient.cjs
// Reads every MPRIS player on the session bus and keeps the newest snapshot. Dux picks one of
// these as its active player; the bridge mirrors Dux by preferring the player that is playing.
// Polling (about once a second) is deliberate: Position is not in PropertiesChanged and several
// players proxy another device (KDE Connect, browsers), where signal delivery is uneven.

const BUS_DESTINATION = 'org.freedesktop.DBus';
const BUS_PATH = '/org/freedesktop/DBus';
const PROPERTIES_INTERFACE = 'org.freedesktop.DBus.Properties';
const PLAYER_INTERFACE = 'org.mpris.MediaPlayer2.Player';
const ROOT_INTERFACE = 'org.mpris.MediaPlayer2';
const PLAYER_PREFIX = 'org.mpris.MediaPlayer2.';
const PLAYERCTLD = 'org.mpris.MediaPlayer2.playerctld';
// Folia's own player: it mirrors the displayed song and must not feed the bridge back into itself.
const OWN_PLAYER = /^org\.mpris\.MediaPlayer2\.folia(\.|$)/;
// Chromium's own media-session player for Folia's web audio, named after the browser (main) process.
const OWN_CHROMIUM_PLAYER = `org.mpris.MediaPlayer2.chromium.instance${process.pid}`;
const DISCOVERY_INTERVAL_MS = 5000;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 3000;
const RECONNECT_DELAY_MS = 30000;
const SIGNAL_DEBOUNCE_MS = 50;

const isMprisName = name => typeof name === 'string'
    && name.startsWith(PLAYER_PREFIX)
    && name !== PLAYERCTLD
    && !OWN_PLAYER.test(name)
    && name !== OWN_CHROMIUM_PLAYER;

/** A method reply's `a{sv}` body: the wire decoder gives entry pairs, but accept a plain object too. */
const propertyMap = raw => {
    if (!raw) return {};
    const entries = Array.isArray(raw) ? raw : Object.entries(raw);
    const map = {};
    for (const entry of entries) {
        if (!Array.isArray(entry) || entry.length < 2) continue;
        const [name, wrapped] = entry;
        if (typeof name !== 'string') continue;
        map[name] = wrapped && typeof wrapped === 'object' && 'value' in wrapped ? wrapped.value : wrapped;
    }
    return map;
};

const asNumber = value => {
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
};

const asText = value => (typeof value === 'string' ? value : '');

const asArtists = value => {
    if (Array.isArray(value)) return value.filter(artist => typeof artist === 'string' && artist);
    if (typeof value === 'string' && value) return [value];
    return [];
};

/** Metadata as the bridge thinks about it, with MPRIS units converted (length is microseconds). */
const normalizeMetadata = raw => {
    const metadata = propertyMap(raw);
    const lengthMicros = asNumber(metadata['mpris:length']);
    return {
        trackId: asText(metadata['mpris:trackid']) || null,
        title: asText(metadata['xesam:title']),
        artists: asArtists(metadata['xesam:artist']),
        album: asText(metadata['xesam:album']),
        artUrl: asText(metadata['mpris:artUrl']) || null,
        url: asText(metadata['xesam:url']) || null,
        lengthSec: lengthMicros !== null && lengthMicros > 0 ? lengthMicros / 1e6 : null,
    };
};

const normalizePlayer = ({ name, root = {}, player = {} }) => {
    const rootMap = propertyMap(root);
    const playerMap = propertyMap(player);
    const positionMicros = asNumber(playerMap.Position);
    return {
        name,
        identity: asText(rootMap.Identity) || name,
        desktopEntry: asText(rootMap.DesktopEntry) || null,
        playbackStatus: asText(playerMap.PlaybackStatus) || 'Stopped',
        canControl: playerMap.CanControl !== false,
        canSeek: playerMap.CanSeek === true,
        canGoNext: playerMap.CanGoNext === true,
        canGoPrevious: playerMap.CanGoPrevious === true,
        positionSec: positionMicros !== null && positionMicros >= 0 ? positionMicros / 1e6 : 0,
        ...normalizeMetadata(playerMap.Metadata),
    };
};

/**
 * The player Dux would show: one that is playing and controllable, otherwise a paused one.
 * `previousName` keeps the current pick while it is still a candidate, so two playing players do
 * not make the bridge flip back and forth on every poll.
 */
const selectActivePlayer = (players, previousName = null) => {
    if (!Array.isArray(players) || players.length === 0) return null;
    const controllable = players.filter(player => player.canControl !== false);
    const pool = controllable.length > 0 ? controllable : players;

    const playing = pool.filter(player => player.playbackStatus === 'Playing');
    if (playing.length > 0) {
        return playing.find(player => player.name === previousName) ?? playing[0];
    }
    const paused = pool.filter(player => player.playbackStatus === 'Paused');
    if (paused.length > 0) {
        return paused.find(player => player.name === previousName) ?? paused[0];
    }
    return null;
};

/** Stable identity for one playback of one track; artwork and lyrics are keyed by it. */
const playerTrackKey = player => {
    if (!player) return null;
    const metadata = [player.trackId ?? '', player.title ?? '', player.artists?.join('/') ?? '', player.album ?? '', player.lengthSec ?? ''];
    return `${player.name}|${metadata.join('|')}`;
};

const createMprisClient = ({
    address,
    uid,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    now = Date.now,
    connect = connectBus,
    onPlayers = () => {},
    log = console,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
}) => {
    let connection = null;
    let pollTimer = null;
    let retryTimer = null;
    let signalTimer = null;
    let names = [];
    let namesAt = 0;
    let roots = new Map();
    let stopped = true;
    let polling = false;
    let disposed = false;

    const call = (message) => connection.call(message);

    const loadNames = async () => {
        const reply = await call({
            destination: BUS_DESTINATION,
            path: BUS_PATH,
            interface: BUS_DESTINATION,
            member: 'ListNames',
        });
        const listed = Array.isArray(reply.body[0]) ? reply.body[0] : [];
        names = listed.filter(isMprisName);
        namesAt = now();
        for (const name of [...roots.keys()]) {
            if (!names.includes(name)) roots.delete(name);
        }
    };

    const loadRoot = async name => {
        if (roots.has(name)) return roots.get(name);
        try {
            const reply = await call({
                destination: name,
                path: '/org/mpris/MediaPlayer2',
                interface: PROPERTIES_INTERFACE,
                member: 'GetAll',
                signature: 's',
                body: [ROOT_INTERFACE],
                timeoutMs,
            });
            const root = propertyMap(reply.body[0]);
            roots.set(name, root);
            return root;
        } catch {
            return {};
        }
    };

    const loadPlayer = async name => {
        const [root, playerReply] = await Promise.all([
            loadRoot(name),
            call({
                destination: name,
                path: '/org/mpris/MediaPlayer2',
                interface: PROPERTIES_INTERFACE,
                member: 'GetAll',
                signature: 's',
                body: [PLAYER_INTERFACE],
                timeoutMs,
            }),
        ]);
        return normalizePlayer({ name, root, player: playerReply.body[0] });
    };

    const poll = async () => {
        if (stopped || disposed || polling || !connection || connection.isClosed()) return;
        polling = true;
        try {
            if (now() - namesAt >= DISCOVERY_INTERVAL_MS) await loadNames();
            const loaded = await Promise.all(names.map(async name => {
                try {
                    return await loadPlayer(name);
                } catch {
                    return null;
                }
            }));
            const players = loaded.filter(Boolean);
            if (!disposed && !stopped) onPlayers(players);
        } catch (error) {
            log.warn('[Dux] could not read MPRIS players', error);
        } finally {
            polling = false;
        }
    };

    const scheduleRefresh = () => {
        if (stopped || disposed || signalTimer) return;
        signalTimer = setTimeoutFn(() => {
            signalTimer = null;
            void poll();
        }, SIGNAL_DEBOUNCE_MS);
        signalTimer?.unref?.();
    };

    const handleSignal = message => {
        if (message.interface === 'org.freedesktop.DBus' && message.member === 'NameOwnerChanged') {
            namesAt = 0;
            scheduleRefresh();
            return;
        }
        if (message.interface === PROPERTIES_INTERFACE && message.member === 'PropertiesChanged') {
            scheduleRefresh();
            return;
        }
        if (message.interface === PLAYER_INTERFACE && message.member === 'Seeked') {
            scheduleRefresh();
        }
    };

    const addMatches = async () => {
        for (const rule of [
            `type='signal',interface='${BUS_DESTINATION}',member='NameOwnerChanged'`,
            `type='signal',interface='${PROPERTIES_INTERFACE}',member='PropertiesChanged'`,
            `type='signal',interface='${PLAYER_INTERFACE}',member='Seeked'`,
        ]) {
            await call({
                destination: BUS_DESTINATION,
                path: BUS_PATH,
                interface: BUS_DESTINATION,
                member: 'AddMatch',
                signature: 's',
                body: [rule],
            }).catch(error => log.warn('[Dux] could not subscribe to MPRIS changes', error));
        }
    };

    const connectOnce = async () => {
        const opened = await connect({ address, uid });
        opened.onSignal(handleSignal);
        opened.onClose(error => {
            if (connection !== opened) return;
            connection = null;
            roots = new Map();
            if (disposed || stopped) return;
            if (error) log.warn('[Dux] session bus connection closed', error);
            scheduleReconnect();
        });
        connection = opened;
        await addMatches();
        namesAt = 0;
        log.info('[Dux] following MPRIS players on the session bus');
    };

    const scheduleReconnect = () => {
        if (disposed || stopped || retryTimer) return;
        retryTimer = setTimeoutFn(() => {
            retryTimer = null;
            void start();
        }, RECONNECT_DELAY_MS);
        retryTimer?.unref?.();
    };

    const start = async () => {
        if (disposed) return;
        stopped = false;
        if (connection && !connection.isClosed()) return;
        try {
            await connectOnce();
            if (pollTimer) clearIntervalFn(pollTimer);
            pollTimer = setIntervalFn(() => void poll(), pollIntervalMs);
            pollTimer?.unref?.();
            await poll();
        } catch (error) {
            log.warn('[Dux] could not connect to the session bus; no Dux player data', error);
            scheduleReconnect();
        }
    };

    const stop = () => {
        stopped = true;
        disposed = true;
        if (pollTimer) clearIntervalFn(pollTimer);
        if (retryTimer) clearTimeoutFn(retryTimer);
        if (signalTimer) clearTimeoutFn(signalTimer);
        pollTimer = null;
        retryTimer = null;
        signalTimer = null;
        connection?.close();
        connection = null;
    };

    return { start, stop };
};

module.exports = {
    createMprisClient,
    isMprisName,
    normalizeMetadata,
    normalizePlayer,
    playerTrackKey,
    propertyMap,
    selectActivePlayer,
};

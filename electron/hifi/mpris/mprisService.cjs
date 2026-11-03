'use strict';

const crypto = require('crypto');
const { variant } = require('./dbusWire.cjs');
const { BUS_NAME, BUS_PATH, DbusError } = require('./dbusConnection.cjs');

// Linux：HiFi 在放时由主进程在会话总线上登记 MPRIS（org.mpris.MediaPlayer2），代替页面里的静音保活。
// 保活是 Chromium 的一路流，PipeWire 设备上有别的流在放就不切采样率（#835）。状态由渲染进程推来，按键转回渲染进程。
// 离开 HiFi 路线时交还总线名，Web 路线上照旧由 Chromium 自己登记。

const OBJECT_PATH = '/org/mpris/MediaPlayer2';
const ROOT_INTERFACE = 'org.mpris.MediaPlayer2';
const PLAYER_INTERFACE = 'org.mpris.MediaPlayer2.Player';
const PROPERTIES_INTERFACE = 'org.freedesktop.DBus.Properties';
const INTROSPECTABLE_INTERFACE = 'org.freedesktop.DBus.Introspectable';
const PEER_INTERFACE = 'org.freedesktop.DBus.Peer';
const BUS_NAME_BASE = 'org.mpris.MediaPlayer2.folia';
const NO_TRACK_PATH = '/org/mpris/MediaPlayer2/TrackList/NoTrack';
const IDENTITY = 'Folia';
// package.json 的 desktopName 去掉 .desktop。
const DESKTOP_ENTRY = 'folia-major';
const REQUEST_NAME_DO_NOT_QUEUE = 4;
const REQUEST_NAME_PRIMARY_OWNER = 1;
const REQUEST_NAME_ALREADY_OWNER = 4;
// 连不上总线时过这么久再试；连上后断了，过一小会儿就重连。HiFi 在放时由定时器自己再试，不等下一次推送。
const RECONNECT_DELAY_MS = 30000;
const RECONNECT_AFTER_DROP_MS = 1000;
// 渲染进程推来的命令；Stop 也只是暂停，Folia 没有「停止」。
const PLAYER_COMMANDS = Object.freeze({
    Play: 'play',
    Pause: 'pause',
    PlayPause: 'playpause',
    Stop: 'stop',
    Next: 'next',
    Previous: 'previous',
});

const INACTIVE_STATE = Object.freeze({ active: false });

const INTROSPECTION_XML = `<!DOCTYPE node PUBLIC "-//freedesktop//DTD D-BUS Object Introspection 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/introspect.dtd">
<node>
  <interface name="${INTROSPECTABLE_INTERFACE}">
    <method name="Introspect"><arg name="data" direction="out" type="s"/></method>
  </interface>
  <interface name="${PEER_INTERFACE}">
    <method name="Ping"/>
    <method name="GetMachineId"><arg name="machine_uuid" direction="out" type="s"/></method>
  </interface>
  <interface name="${PROPERTIES_INTERFACE}">
    <method name="Get">
      <arg name="interface_name" direction="in" type="s"/>
      <arg name="property_name" direction="in" type="s"/>
      <arg name="value" direction="out" type="v"/>
    </method>
    <method name="GetAll">
      <arg name="interface_name" direction="in" type="s"/>
      <arg name="properties" direction="out" type="a{sv}"/>
    </method>
    <method name="Set">
      <arg name="interface_name" direction="in" type="s"/>
      <arg name="property_name" direction="in" type="s"/>
      <arg name="value" direction="in" type="v"/>
    </method>
    <signal name="PropertiesChanged">
      <arg name="interface_name" type="s"/>
      <arg name="changed_properties" type="a{sv}"/>
      <arg name="invalidated_properties" type="as"/>
    </signal>
  </interface>
  <interface name="${ROOT_INTERFACE}">
    <method name="Raise"/>
    <method name="Quit"/>
    <property name="CanQuit" type="b" access="read"/>
    <property name="CanRaise" type="b" access="read"/>
    <property name="HasTrackList" type="b" access="read"/>
    <property name="Identity" type="s" access="read"/>
    <property name="DesktopEntry" type="s" access="read"/>
    <property name="SupportedUriSchemes" type="as" access="read"/>
    <property name="SupportedMimeTypes" type="as" access="read"/>
  </interface>
  <interface name="${PLAYER_INTERFACE}">
    <method name="Next"/>
    <method name="Previous"/>
    <method name="Pause"/>
    <method name="PlayPause"/>
    <method name="Stop"/>
    <method name="Play"/>
    <method name="Seek"><arg name="Offset" direction="in" type="x"/></method>
    <method name="SetPosition">
      <arg name="TrackId" direction="in" type="o"/>
      <arg name="Position" direction="in" type="x"/>
    </method>
    <method name="OpenUri"><arg name="Uri" direction="in" type="s"/></method>
    <signal name="Seeked"><arg name="Position" type="x"/></signal>
    <property name="PlaybackStatus" type="s" access="read"/>
    <property name="Rate" type="d" access="readwrite"/>
    <property name="Metadata" type="a{sv}" access="read"/>
    <property name="Volume" type="d" access="readwrite"/>
    <property name="Position" type="x" access="read"/>
    <property name="MinimumRate" type="d" access="read"/>
    <property name="MaximumRate" type="d" access="read"/>
    <property name="CanGoNext" type="b" access="read"/>
    <property name="CanGoPrevious" type="b" access="read"/>
    <property name="CanPlay" type="b" access="read"/>
    <property name="CanPause" type="b" access="read"/>
    <property name="CanSeek" type="b" access="read"/>
    <property name="CanControl" type="b" access="read"/>
  </interface>
</node>
`;

/** 曲目的对象路径：trackKey 的哈希，只用对象路径收得下的字符。 */
const trackIdPath = trackKey => `/top/izuna/folia/track/t${crypto.createHash('sha1').update(trackKey).digest('hex').slice(0, 24)}`;

const toMicroseconds = seconds => BigInt(Math.max(0, Math.round(seconds * 1e6)));

/** Metadata 属性（a{sv}）：没有曲目时只有 NoTrack 的 trackid。 */
const buildMetadata = (state, artUrl) => {
    if (!state.active) return [['mpris:trackid', variant('o', NO_TRACK_PATH)]];
    const entries = [['mpris:trackid', variant('o', trackIdPath(state.trackKey))]];
    if (state.durationSec !== null && state.durationSec > 0) entries.push(['mpris:length', variant('x', toMicroseconds(state.durationSec))]);
    entries.push(['xesam:title', variant('s', state.title)]);
    if (state.artists.length > 0) entries.push(['xesam:artist', variant('as', state.artists)]);
    if (state.album) entries.push(['xesam:album', variant('s', state.album)]);
    if (artUrl) entries.push(['mpris:artUrl', variant('s', artUrl)]);
    return entries;
};

/** 推来时的位置按推来的时刻往后外推；暂停、停止时不动。不超过时长。 */
const currentPositionSec = (state, nowMs) => {
    if (!state.active) return 0;
    let position = state.positionSec;
    if (state.status === 'Playing') position += Math.max(0, nowMs - state.atMs) / 1000;
    if (state.durationSec !== null && state.durationSec > 0) position = Math.min(position, state.durationSec);
    return Math.max(0, position);
};

const rootProperties = () => ({
    CanQuit: variant('b', false),
    CanRaise: variant('b', true),
    HasTrackList: variant('b', false),
    Identity: variant('s', IDENTITY),
    DesktopEntry: variant('s', DESKTOP_ENTRY),
    SupportedUriSchemes: variant('as', []),
    SupportedMimeTypes: variant('as', []),
});

// CanSeek 为假：页面的 Media Session 也没登记跳转，系统面板里拖进度条在 Web 路线上同样不行。
const playerProperties = (state, artUrl, nowMs) => {
    const controllable = state.active === true;
    return {
        PlaybackStatus: variant('s', state.active ? state.status : 'Stopped'),
        Rate: variant('d', 1),
        Metadata: variant('a{sv}', buildMetadata(state, artUrl)),
        Volume: variant('d', 1),
        Position: variant('x', toMicroseconds(currentPositionSec(state, nowMs))),
        MinimumRate: variant('d', 1),
        MaximumRate: variant('d', 1),
        CanGoNext: variant('b', controllable),
        CanGoPrevious: variant('b', controllable),
        CanPlay: variant('b', controllable),
        CanPause: variant('b', controllable),
        CanSeek: variant('b', false),
        CanControl: variant('b', true),
    };
};

// 变了要发 PropertiesChanged 的属性。Position 按规范不发，跳转另发 Seeked。
const WATCHED_PLAYER_PROPERTIES = Object.freeze(['PlaybackStatus', 'Metadata', 'CanGoNext', 'CanGoPrevious', 'CanPlay', 'CanPause']);

const sameValue = (left, right) => JSON.stringify(left, (_key, value) => (typeof value === 'bigint' ? `${value}n` : value))
    === JSON.stringify(right, (_key, value) => (typeof value === 'bigint' ? `${value}n` : value));

/** 两次属性快照之间变了的那些，按 WATCHED_PLAYER_PROPERTIES 的顺序。 */
const changedPlayerProperties = (before, after) => WATCHED_PLAYER_PROPERTIES
    .filter(name => !before || !sameValue(before[name], after[name]))
    .map(name => [name, after[name]]);

/**
 * connect() → Promise<连接>（dbusConnection.cjs 的 connectBus 绑好地址和 uid）；onCommand(命令) 把按键交给渲染进程；
 * onRaise() 把主窗口拿到前面；readMachineId() 给 Peer.GetMachineId；onRegistered(是否) 在 HiFi 在放时每走一遍都报
 * 登记成没成（页面重新载入后也能马上知道），渲染进程据此决定要不要退回页面里的静音保活。
 */
const createMprisService = ({
    connect,
    onCommand,
    onRaise,
    onRegistered = () => {},
    readMachineId = () => '',
    now = Date.now,
    pid = process.pid,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
}) => {
    let desired = INACTIVE_STATE;
    let artwork = { trackKey: null, url: null };
    let connection = null;
    let ownedName = null;
    /** 上次发出去（或登记总线名时）的 Player 属性快照。 */
    let published = null;
    let seekPending = false;
    let retryAtMs = 0;
    let running = false;
    let again = false;
    let disposed = false;
    let retryTimer = null;

    const report = registered => {
        try {
            onRegistered(registered);
        } catch (error) {
            console.warn('[MPRIS] the registration listener threw', error);
        }
    };

    // HiFi 在放、却没登记上时，到点自己再走一遍；不在 HiFi 路线上就不用。
    const retryIn = delayMs => {
        if (disposed || retryTimer) return;
        retryTimer = setTimer(() => {
            retryTimer = null;
            if (desired.active) schedule();
        }, delayMs);
        retryTimer?.unref?.();
    };

    const artUrlFor = state => (state.active && artwork.trackKey === state.trackKey ? artwork.url : null);
    const snapshot = () => playerProperties(desired, artUrlFor(desired), now());

    const propertiesOf = iface => {
        if (iface === ROOT_INTERFACE) return rootProperties();
        if (iface === PLAYER_INTERFACE) return snapshot();
        throw new DbusError('org.freedesktop.DBus.Error.UnknownInterface', `No interface ${iface}`);
    };

    const handlePlayerCall = member => {
        if (member === 'Seek' || member === 'SetPosition') return {}; // CanSeek 为假：按规范什么也不做。
        if (member === 'OpenUri') throw new DbusError('org.freedesktop.DBus.Error.NotSupported', 'Folia does not open URIs');
        const command = PLAYER_COMMANDS[member];
        if (!command) throw new DbusError('org.freedesktop.DBus.Error.UnknownMethod', `No method ${member}`);
        if (desired.active) onCommand(command);
        return {};
    };

    const handleMethodCall = message => {
        if (message.path !== OBJECT_PATH) {
            throw new DbusError('org.freedesktop.DBus.Error.UnknownObject', `No object at ${message.path}`);
        }
        const iface = message.interface ?? null;
        const { member } = message;
        if (iface === PROPERTIES_INTERFACE) {
            if (member === 'Get' && message.signature === 'ss') {
                const properties = propertiesOf(message.body[0]);
                const value = properties[message.body[1]];
                if (!value) throw new DbusError('org.freedesktop.DBus.Error.UnknownProperty', `No property ${message.body[1]}`);
                return { signature: 'v', body: [value] };
            }
            if (member === 'GetAll' && message.signature === 's') {
                return { signature: 'a{sv}', body: [Object.entries(propertiesOf(message.body[0]))] };
            }
            if (member === 'Set' && message.signature === 'ssv') {
                const [targetInterface, name] = message.body;
                const properties = propertiesOf(targetInterface);
                if (!properties[name]) throw new DbusError('org.freedesktop.DBus.Error.UnknownProperty', `No property ${name}`);
                // Rate 和 Volume 规范上可写，写了不生效；HiFi 的音量在 Folia 里调。
                if (targetInterface === PLAYER_INTERFACE && (name === 'Rate' || name === 'Volume')) return {};
                throw new DbusError('org.freedesktop.DBus.Error.PropertyReadOnly', `Property ${name} is read-only`);
            }
            throw new DbusError('org.freedesktop.DBus.Error.InvalidArgs', `Bad call ${member}(${message.signature})`);
        }
        if (iface === INTROSPECTABLE_INTERFACE || (iface === null && member === 'Introspect')) {
            if (member !== 'Introspect') throw new DbusError('org.freedesktop.DBus.Error.UnknownMethod', `No method ${member}`);
            return { signature: 's', body: [INTROSPECTION_XML] };
        }
        if (iface === PEER_INTERFACE) {
            if (member === 'Ping') return {};
            if (member === 'GetMachineId') return { signature: 's', body: [readMachineId()] };
            throw new DbusError('org.freedesktop.DBus.Error.UnknownMethod', `No method ${member}`);
        }
        if (iface === ROOT_INTERFACE || (iface === null && (member === 'Raise' || member === 'Quit'))) {
            if (member === 'Raise') {
                onRaise();
                return {};
            }
            if (member === 'Quit') return {}; // CanQuit 为假。
            throw new DbusError('org.freedesktop.DBus.Error.UnknownMethod', `No method ${member}`);
        }
        if (iface === PLAYER_INTERFACE || iface === null) return handlePlayerCall(member);
        throw new DbusError('org.freedesktop.DBus.Error.UnknownInterface', `No interface ${iface}`);
    };

    const busCall = (member, signature, body) => connection.call({
        destination: BUS_NAME,
        path: BUS_PATH,
        interface: BUS_NAME,
        member,
        signature,
        body,
    });

    // 先要 org.mpris.MediaPlayer2.folia；被占了（另一个 Folia 的 profile）就加上 .instance<pid>。
    const requestName = async () => {
        for (const name of [BUS_NAME_BASE, `${BUS_NAME_BASE}.instance${pid}`]) {
            const reply = await busCall('RequestName', 'su', [name, REQUEST_NAME_DO_NOT_QUEUE]);
            const code = reply.body[0];
            if (code === REQUEST_NAME_PRIMARY_OWNER || code === REQUEST_NAME_ALREADY_OWNER) return name;
        }
        return null;
    };

    const ensureConnection = async () => {
        if (connection && !connection.isClosed()) return true;
        if (now() < retryAtMs) return false;
        try {
            const opened = await connect();
            opened.onMethodCall(handleMethodCall);
            opened.onClose(error => {
                if (connection !== opened) return;
                connection = null;
                ownedName = null;
                published = null;
                if (disposed) return;
                console.warn('[MPRIS] the session bus connection closed', error ?? undefined);
                if (desired.active) {
                    report(false);
                    retryIn(RECONNECT_AFTER_DROP_MS);
                }
            });
            connection = opened;
            console.info('[MPRIS] connected to the session bus', { uniqueName: opened.uniqueName });
            return true;
        } catch (error) {
            retryAtMs = now() + RECONNECT_DELAY_MS;
            console.warn('[MPRIS] could not connect to the session bus: no system media controls for HiFi', error);
            retryIn(RECONNECT_DELAY_MS);
            return false;
        }
    };

    const step = async () => {
        if (!desired.active) {
            seekPending = false;
            if (connection && ownedName) {
                const name = ownedName;
                ownedName = null;
                published = null;
                await busCall('ReleaseName', 's', [name]);
                console.info('[MPRIS] released the bus name: HiFi stopped', { name });
            }
            return;
        }
        if (!(await ensureConnection())) {
            report(false);
            return;
        }
        if (!ownedName) {
            // 属性先就位再要名字：媒体面板一看到名字就会来读。
            published = snapshot();
            seekPending = false;
            ownedName = await requestName();
            if (ownedName) console.info('[MPRIS] registered the HiFi player', { name: ownedName });
            else console.warn('[MPRIS] could not own an MPRIS bus name: no system media controls for HiFi');
            report(ownedName !== null);
            return;
        }
        report(true);
        const next = snapshot();
        const changed = changedPlayerProperties(published, next);
        published = next;
        if (changed.length > 0) {
            connection.emitSignal({
                path: OBJECT_PATH,
                interface: PROPERTIES_INTERFACE,
                member: 'PropertiesChanged',
                signature: 'sa{sv}as',
                body: [PLAYER_INTERFACE, changed, []],
            });
        }
        if (seekPending) {
            seekPending = false;
            connection.emitSignal({
                path: OBJECT_PATH,
                interface: PLAYER_INTERFACE,
                member: 'Seeked',
                signature: 'x',
                body: [next.Position.value],
            });
        }
    };

    // 推送随时会来，总线上的动作一次只做一组：在做时来的推送等这一组做完再按最新的状态补一次。
    const schedule = () => {
        if (disposed) return;
        if (running) {
            again = true;
            return;
        }
        running = true;
        void (async () => {
            try {
                do {
                    again = false;
                    try {
                        await step();
                    } catch (error) {
                        console.warn('[MPRIS] could not update the HiFi player on the session bus', error);
                        if (desired.active && !ownedName) report(false);
                    }
                } while (again && !disposed);
            } finally {
                running = false;
            }
        })();
    };

    return {
        /** 渲染进程推来的状态（mprisIpc.cjs 校验过）；seeked 为真时补发 Seeked。 */
        update: state => {
            if (state.active && desired.active && state.trackKey !== desired.trackKey) seekPending = false;
            desired = state.active ? state : INACTIVE_STATE;
            if (state.active && state.seeked) seekPending = true;
            schedule();
        },
        /** 这首的封面（file:// 或 http(s)），null 为没有。 */
        setArtwork: (trackKey, url) => {
            artwork = { trackKey, url };
            schedule();
        },
        currentTrackKey: () => (desired.active ? desired.trackKey : null),
        dispose: () => {
            disposed = true;
            if (retryTimer) clearTimer(retryTimer);
            retryTimer = null;
            connection?.close();
            connection = null;
        },
    };
};

module.exports = {
    OBJECT_PATH,
    PLAYER_INTERFACE,
    ROOT_INTERFACE,
    BUS_NAME_BASE,
    NO_TRACK_PATH,
    trackIdPath,
    buildMetadata,
    currentPositionSec,
    playerProperties,
    changedPlayerProperties,
    createMprisService,
};

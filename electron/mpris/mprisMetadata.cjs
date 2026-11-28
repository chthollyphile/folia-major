'use strict';

// MPRIS 属性（a{sv}，值已解成变体）→ 渲染进程用的快照。纯函数，单测直接喂解码后的属性。

const MAX_TEXT_CHARS = 2048;
const MAX_LYRIC_CHARS = 64 * 1024;
const MAX_ARTISTS = 16;
const MAX_ART_URL_CHARS = 8192;
const MAX_PLAYERS = 32;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** 变体解码成 { signature, value }。 */
const unwrapVariant = value => (
    isPlainObject(value) && typeof value.signature === 'string' && 'value' in value ? value.value : value
);

/** GetAll 的 a{sv} → 对象；坏条目跳过。 */
const propertiesToObject = entries => {
    const properties = Object.create(null);
    if (!Array.isArray(entries)) return properties;
    for (const entry of entries) {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') continue;
        properties[entry[0]] = unwrapVariant(entry[1]);
    }
    return properties;
};

const cleanText = (value, maxChars = MAX_TEXT_CHARS) => (
    typeof value === 'string' ? value.slice(0, maxChars).replace(CONTROL_CHARS, ' ').trim() : ''
);

const textList = value => {
    const items = Array.isArray(value) ? value : [value];
    return items.map(item => cleanText(item)).filter(Boolean).slice(0, MAX_ARTISTS);
};

/** mpris:length / Position 是微秒的 x（BigInt），这里换成秒。 */
const microsecondsToSeconds = value => {
    if (typeof value === 'bigint') {
        const seconds = Number(value) / 1e6;
        return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        const seconds = value / 1e6;
        return seconds > 0 ? seconds : 0;
    }
    return 0;
};

const readStatus = value => (value === 'Playing' ? 'playing' : value === 'Paused' ? 'paused' : 'stopped');

/** 只收页面能直接加载的封面；file:// 暂不支持。 */
const readArtUrl = value => {
    if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ART_URL_CHARS) return null;
    if (/^https?:\/\//i.test(value) || /^data:image\//i.test(value)) return value;
    return null;
};

const readMetadata = metadata => {
    const lyricText = typeof metadata['xesam:asText'] === 'string'
        ? metadata['xesam:asText'].slice(0, MAX_LYRIC_CHARS)
        : '';
    return {
        title: cleanText(metadata['xesam:title']),
        artists: textList(metadata['xesam:artist']),
        album: cleanText(metadata['xesam:album']),
        trackId: cleanText(metadata['mpris:trackid']) || null,
        durationSec: microsecondsToSeconds(metadata['mpris:length']),
        artUrl: readArtUrl(metadata['mpris:artUrl']),
        lyricText,
    };
};

/** 一个播放器的快照。activeAtMs 只在状态或曲目变化时更新；位置每秒都在变。 */
const buildPlayerSnapshot = ({ busName, identity, properties, previous, nowMs }) => {
    const metadata = properties.Metadata ? propertiesToObject(properties.Metadata) : {};
    const track = readMetadata(metadata);
    const status = readStatus(properties.PlaybackStatus);
    const rateValue = typeof properties.Rate === 'number' ? properties.Rate : 1;
    // 浏览器标签没有 mpris:trackid，曲名变了也要算换歌。
    const unchanged = Boolean(
        previous
        && previous.status === status
        && previous.trackId === track.trackId
        && previous.title === track.title
        && previous.artists.join('\u0000') === track.artists.join('\u0000'),
    );
    return {
        busName: cleanText(busName, 256),
        identity: cleanText(identity) || cleanText(busName, 256),
        status,
        trackId: track.trackId,
        title: track.title,
        artists: track.artists,
        album: track.album,
        artUrl: track.artUrl,
        durationSec: track.durationSec,
        positionSec: microsecondsToSeconds(properties.Position),
        rate: Number.isFinite(rateValue) && rateValue > 0 ? rateValue : 1,
        lyricText: track.lyricText,
        sampledAtMs: nowMs,
        activeAtMs: unchanged ? previous.activeAtMs : nowMs,
    };
};

/** 正在放的优先，其次暂停的；再按最近变化、总线名。 */
const pickActiveBusName = players => {
    const playing = players.filter(player => player.status === 'playing');
    const pool = playing.length > 0 ? playing : players.filter(player => player.status === 'paused');
    let picked = null;
    for (const player of pool) {
        if (!picked
            || player.activeAtMs > picked.activeAtMs
            || (player.activeAtMs === picked.activeAtMs && player.busName < picked.busName)) {
            picked = player;
        }
    }
    return picked ? picked.busName : null;
};

module.exports = {
    MAX_PLAYERS,
    unwrapVariant,
    propertiesToObject,
    microsecondsToSeconds,
    readMetadata,
    buildPlayerSnapshot,
    pickActiveBusName,
};

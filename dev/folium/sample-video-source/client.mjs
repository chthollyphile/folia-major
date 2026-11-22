// dev/folium/sample-video-source/client.mjs
// Folium 2.0 sample of `playback.surface@1` (plan §4.2, §4.4): a source whose videos play in a <video> of its own,
// shown on the player page in the box the host keeps there, and whose one song plays as the host's own audio
// (`routeOf`). The clips are three small test videos in `media/`, served by the main entry over the `_media`
// route (with Range, so the video can seek); the song is a tone this file writes as a WAV. Nothing connects to
// any real platform. test/unit/mod-system/foliumSampleVideoSource.test.ts drives it through omni; the desktop
// check installs it as a mod.
//
// Registered before the first `await` of activate, as the contract asks, so the first screen finds it.

/** @typedef {import('../../../mods/folium').FoliumClientApi} FoliumClientApi */
/** @typedef {import('../../../mods/folium').FoliumSourceSong} FoliumSourceSong */
/** @typedef {import('../../../mods/folium').FoliumSourceExternalStatus} FoliumSourceExternalStatus */

const MOD_ID = 'sample-video-source';

// ---- the catalog: three clips and a song

const CLIPS = [
    { id: 'v-a', title: '测试图卡 A', file: 'clip-a.webm', color: '#3b82f6' },
    { id: 'v-b', title: '彩条 B', file: 'clip-b.webm', color: '#f59e0b' },
    { id: 'v-c', title: '测试图卡 C', file: 'clip-c.webm', color: '#10b981' },
].map((clip) => ({ ...clip, kind: 'video', durationMs: 12000 }));

const SONGS = [{ id: 's-tone', title: '间奏（音频）', tone: 392, color: '#a855f7', kind: 'song', durationMs: 8000 }];

const ITEMS = [...CLIPS, ...SONGS];

const itemOf = (id) => ITEMS.find((item) => item.id === id);

/** A cover drawn here: a square of the item's colour with its first letter. */
const coverOf = (item) => `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" fill="${item.color}"/><text x="60" y="76" font-size="48" text-anchor="middle" fill="#fff" font-family="sans-serif">${item.kind === 'video' ? '▶' : '♪'}</text></svg>`,
)}`;

/** One item as the contract's DTO. @returns {FoliumSourceSong} */
const toSong = (item) => ({
    id: item.id,
    title: item.title,
    artists: [{ id: 'sample', name: 'Folium 示范', ref: false }],
    album: { id: 'sample-reel', name: '示范片段', coverUrl: coverOf(item), ref: false },
    durationMs: item.durationMs,
    coverUrl: coverOf(item),
    ...(item.kind === 'video' ? { kind: 'video', video: true } : {}),
});

const page = (items, limit, offset) => ({
    items: items.slice(offset, offset + limit),
    total: items.length,
    hasMore: offset + limit < items.length,
});

const matches = (query) => {
    const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
    return (text) => words.every((word) => text.toLowerCase().includes(word));
};

// ---- the song's audio: a tone with a soft start and end, as an 8-bit mono WAV

const toneUrl = (frequency, seconds) => {
    const rate = 11025;
    const count = rate * seconds;
    const bytes = new Uint8Array(44 + count);
    const view = new DataView(bytes.buffer);
    const text = (at, value) => [...value].forEach((char, index) => view.setUint8(at + index, char.charCodeAt(0)));
    text(0, 'RIFF');
    view.setUint32(4, 36 + count, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate, true);
    view.setUint16(32, 1, true);
    view.setUint16(34, 8, true);
    text(36, 'data');
    view.setUint32(40, count, true);
    for (let index = 0; index < count; index += 1) {
        const t = index / rate;
        const envelope = Math.min(1, t * 4, (seconds - t) * 4);
        bytes[44 + index] = 128 + Math.round(48 * envelope * Math.sin(2 * Math.PI * frequency * t));
    }
    let binary = '';
    for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
    return `data:audio/wav;base64,${btoa(binary)}`;
};

// ---- the player: one <video>, moved into whichever box the host gives

/**
 * The player of this source's clips. It lives in this window's page: when the window goes, it goes, and the
 * host starts the clip again in the new window (`play` at the position it had).
 */
const createVideoPlayer = (log) => {
    /** @type {HTMLVideoElement | null} */
    let video = null;
    /** The clip loaded now, or null. */
    let loaded = null;
    /** A start that has not begun to play yet. */
    let starting = false;

    const element = () => {
        if (video) return video;
        video = document.createElement('video');
        video.playsInline = true;
        video.preload = 'auto';
        video.style.cssText = 'width: 100%; height: 100%; object-fit: cover; background: #000; display: block;';
        video.addEventListener('playing', () => { starting = false; });
        video.addEventListener('error', () => {
            starting = false;
            log.warn(`the clip ${loaded ?? '?'} could not be played: ${video?.error?.message || video?.error?.code || 'unknown error'}`);
        });
        return video;
    };

    const urlOf = (clip) => `folia-mod://${MOD_ID}/_media/clips/${clip.file}`;

    return {
        /** @param {FoliumSourceSong} song */
        canPlay: (song) => CLIPS.some((clip) => clip.id === song.id),
        play: async (song, startSec) => {
            const clip = CLIPS.find((entry) => entry.id === song.id);
            if (!clip) throw new Error(`no clip ${song.id}`);
            const player = element();
            if (loaded !== clip.id) {
                loaded = clip.id;
                player.src = urlOf(clip);
            }
            player.currentTime = Math.max(0, startSec);
            starting = true;
            try {
                await player.play();
            } catch (error) {
                starting = false;
                throw error;
            }
        },
        pause: async () => {
            starting = false;
            video?.pause();
        },
        resume: async () => {
            if (!video || !loaded) return;
            await video.play();
        },
        seek: async (seconds) => {
            if (video && loaded) video.currentTime = Math.max(0, seconds);
        },
        setVolume: async (volume) => {
            element().volume = Math.min(1, Math.max(0, volume));
        },
        setRepeatOne: async (enabled) => {
            element().loop = enabled;
        },
        /** @returns {Promise<FoliumSourceExternalStatus>} */
        getStatus: async () => {
            // Nothing loaded (a new window, say) is an empty status, not a failure.
            if (!video || !loaded) return { mediaId: '', isPlaying: false, positionMs: 0, durationMs: 0, ended: false };
            if (video.error) throw new Error(`the clip ${loaded} could not be played (${video.error.code})`);
            const durationMs = Number.isFinite(video.duration) ? video.duration * 1000 : 0;
            return {
                mediaId: loaded,
                isPlaying: !video.paused && !video.ended && !starting,
                positionMs: video.currentTime * 1000,
                durationMs,
                ended: video.ended,
                seeking: video.seeking,
                starting: starting && !video.paused,
            };
        },
        isStatusForSong: (song, status) => status.mediaId === song.id,
        mount: (container) => {
            const player = element();
            container.append(player);
            return () => {
                // Out of this box; the next song's box takes it back (a <video> moved within one task keeps playing).
                if (player.parentNode === container) player.remove();
            };
        },
    };
};

/** @param {FoliumClientApi} folium */
export default function activate(folium) {
    const player = createVideoPlayer(folium.log);
    const handle = folium.sources.register({
        id: 'clips',
        displayName: { 'zh-CN': '示范视频源', en: 'Sample video source' },
        shortName: { 'zh-CN': '示范视频', en: 'Sample video' },
        mark: { letter: '影', color: '#0ea5e9' },
        // Videos have no lyrics, are not liked and not reported; the song is a song.
        itemKinds: { video: { lyrics: 'none', likable: false, reported: false } },
        // Clips play in the video player, the song as the host's audio.
        routeOf: (song) => (song.kind === 'video' ? 'surface' : 'audio'),
        capabilities: {
            'search@1': {
                searchSongs: async (query, limit, offset) => page(ITEMS.filter((item) => matches(query)(`${item.title} Folium 示范片段`)).map(toSong), limit, offset),
            },
            'songs@1': {
                getSong: async (id) => (itemOf(id) ? toSong(itemOf(id)) : null),
                getSongs: async (ids) => ids.map((id) => (itemOf(id) ? toSong(itemOf(id)) : null)),
            },
            'playback.surface@1': player,
            'playback.audio@1': {
                getAudioSource: async (song) => {
                    const item = SONGS.find((entry) => entry.id === song.id);
                    return item ? { url: toneUrl(item.tone, item.durationMs / 1000), quality: 'standard' } : null;
                },
                audioQualityLevels: ['standard'],
            },
        },
    });
    folium.log.info(`registered ${handle.id}: ${CLIPS.length} clips and ${SONGS.length} song`);
}

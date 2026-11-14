// dev/folium/sample-source-full/client.mjs
// Folium 2.0 sample and contract test: a source that implements every family of standard capabilities, and a
// second one that plays through an "external player" of its own. Everything is made up here: the catalog is a
// few lines of data, the audio is a tone this file writes as a WAV, the external player is a clock, and
// nothing connects to any real platform. test/unit/mod-system/foliumSampleSourceFull.test.ts drives it through
// omni family by family; the desktop check installs it as a mod.
//
// Registered before the first `await` of activate, as the contract asks, so the first screen finds it.

/** @typedef {import('../../../mods/folium').FoliumClientApi} FoliumClientApi */
/** @typedef {import('../../../mods/folium').FoliumSourceSong} FoliumSourceSong */
/** @typedef {import('../../../mods/folium').FoliumSourceCollection} FoliumSourceCollection */

const COVER_HOST = 'covers.sample-source.invalid';

// ---- the catalog

const ARTISTS = [
    { id: 'ar-1', name: '晨雾乐队', description: '只存在于契约测试里的乐队。' },
    { id: 'ar-2', name: 'Lumen Trio', description: 'A trio that plays only in tests.' },
    { id: 'ar-3', name: '北岸', description: '第三位歌手。' },
];

const ALBUMS = [
    { id: 'al-1', name: '雾中的城', artist: 'ar-1', year: 2021 },
    { id: 'al-2', name: 'Paper Lanterns', artist: 'ar-2', year: 2023 },
    { id: 'al-3', name: '潮汐表', artist: 'ar-3', year: 2024 },
];

const TONES = [262, 294, 330, 349, 392, 440, 494, 523, 587];

const SONGS = [
    ['s-1', '清晨的第一班车', 'ar-1', 'al-1'],
    ['s-2', '雾', 'ar-1', 'al-1'],
    ['s-3', '城市灯火', 'ar-1', 'al-1'],
    ['s-4', 'Paper Lanterns', 'ar-2', 'al-2'],
    ['s-5', 'Slow River', 'ar-2', 'al-2'],
    ['s-6', 'Night Market', 'ar-2', 'al-2'],
    ['s-7', '潮汐', 'ar-3', 'al-3'],
    ['s-8', '灯塔', 'ar-3', 'al-3'],
    ['s-9', '回声', 'ar-3', 'al-3'],
].map(([id, title, artistId, albumId], index) => ({ id, title, artistId, albumId, tone: TONES[index], durationMs: 6000 }));

const PLAYLISTS = [
    { id: 'pl-1', name: '契约测试歌单', owner: 'fixture-user', songs: ['s-1', 's-4', 's-7'] },
    { id: 'pl-2', name: '公开的歌单', owner: 'someone-else', songs: ['s-2', 's-5', 's-8', 's-9'] },
];

const coverOf = (id) => `https://${COVER_HOST}/${id}.png?size=300`;
const artistOf = (id) => ARTISTS.find((artist) => artist.id === id);
const albumOf = (id) => ALBUMS.find((album) => album.id === id);
const songRow = (id) => SONGS.find((song) => song.id === id);

/** One song as the contract's DTO. @returns {FoliumSourceSong} */
const toSong = (row) => {
    const artist = artistOf(row.artistId);
    const album = albumOf(row.albumId);
    return {
        id: row.id,
        title: row.title,
        artists: [{ id: artist.id, name: artist.name }],
        album: { id: album.id, name: album.name, coverUrl: coverOf(album.id) },
        durationMs: row.durationMs,
        aliases: [`${row.title} (sample)`],
        lyricIds: { fixture: row.id },
        data: { tone: row.tone },
    };
};

/** @returns {FoliumSourceCollection} */
const toAlbum = (album) => ({
    id: album.id,
    type: 'album',
    name: album.name,
    coverUrl: coverOf(album.id),
    artists: [{ id: album.artist, name: artistOf(album.artist).name }],
    trackCount: SONGS.filter((song) => song.albumId === album.id).length,
    publishedAt: Date.UTC(album.year, 0, 1),
});

/** @returns {FoliumSourceCollection} */
const toArtist = (artist) => ({
    id: artist.id,
    type: 'artist',
    name: artist.name,
    description: artist.description,
    coverUrl: coverOf(artist.id),
    albumCount: ALBUMS.filter((album) => album.artist === artist.id).length,
});

/** @returns {FoliumSourceCollection} */
const toPlaylist = (playlist, state) => ({
    id: playlist.id,
    type: 'playlist',
    name: playlist.name,
    coverUrl: coverOf(playlist.id),
    trackCount: playlist.songs.length,
    isOwned: Boolean(state.user) && playlist.owner === 'fixture-user',
    creator: { id: playlist.owner, nickname: playlist.owner },
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

// ---- the audio: a tone with a soft start and end, as an 8-bit mono WAV

const toneUrl = (frequency, seconds = 6) => {
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

// ---- the lyrics: one line a second, and a word-timed version with a translation

const lyricsOf = (row) => {
    const lines = [row.title, `${artistOf(row.artistId).name} · ${albumOf(row.albumId).name}`, '契约测试的第三行', '最后一行'];
    const stamp = (ms) => `[00:${String(Math.floor(ms / 1000)).padStart(2, '0')}.${String(Math.floor((ms % 1000) / 10)).padStart(2, '0')}]`;
    const main = lines.map((line, index) => `${stamp(index * 1500)}${line}`).join('\n');
    const translation = lines.map((line, index) => `${stamp(index * 1500)}(${index + 1}) ${line}`).join('\n');
    const yrc = lines.map((line, index) => {
        const start = index * 1500;
        const chars = [...line];
        const each = Math.floor(1400 / Math.max(1, chars.length));
        return `[${start},1400]${chars.map((char, at) => `(${start + at * each},${each},0)${char}`).join('')}`;
    }).join('\n');
    return {
        main: { format: 'lrc', text: main, translationText: translation },
        wordByWord: { format: 'yrc', text: yrc },
        chorusRanges: [{ startTime: 3, endTime: 4.5 }],
    };
};

/** @param {FoliumClientApi} folium */
export default function activate(folium) {
    const { sources, i18n } = folium;
    const store = sources.pageStore('fixture');
    const read = (key, fallback) => {
        const value = store.get(key);
        try {
            return value === null ? fallback : JSON.parse(value);
        } catch {
            return fallback;
        }
    };
    const state = {
        user: read('user', null),
        liked: new Set(read('liked', [])),
        playlists: read('playlists', null) ?? PLAYLISTS.map((playlist) => ({ ...playlist, songs: [...playlist.songs] })),
        logins: new Map(),
        reports: [],
    };
    const save = () => {
        store.set('user', state.user ? JSON.stringify(state.user) : null);
        store.set('liked', JSON.stringify([...state.liked]));
        store.set('playlists', JSON.stringify(state.playlists));
    };
    const requireUser = () => {
        if (!state.user) throw sources.error('auth-required', 'sign in to the contract test source first');
        return state.user;
    };
    const playlistById = (id) => state.playlists.find((playlist) => playlist.id === String(typeof id === 'object' ? id.id : id));
    const songIdOf = (song) => String(typeof song === 'object' ? song.id : song);
    const sourceSongs = (ids) => ids.map(songRow).filter(Boolean).map(toSong);

    const handle = sources.register({
        id: 'fixture',
        displayName: i18n.key('source.name'),
        shortName: i18n.key('source.short'),
        mark: { letter: '契', color: '#6b7cff' },
        getAvailability: () => AVAILABLE,
        describeFailure: (operation, error) => (error?.code === 'not-playable' ? { case: 'no-audio', message: String(error.message) } : null),
        capabilities: {
            'search@1': {
                searchSongs: async (query, limit, offset) => page(SONGS.filter((row) => matches(query)(`${row.title} ${artistOf(row.artistId).name}`)).map(toSong), limit, offset),
                searchAlbums: async (query, limit, offset) => page(ALBUMS.filter((album) => matches(query)(album.name)).map(toAlbum), limit, offset),
                searchPlaylists: async (query, limit, offset) => page(state.playlists.filter((playlist) => matches(query)(playlist.name)).map((playlist) => toPlaylist(playlist, state)), limit, offset),
            },
            'songs@1': {
                metadataMatch: true,
                getSong: async (id) => (songRow(id) ? toSong(songRow(id)) : null),
                getSongs: async (ids) => ids.map((id) => (songRow(id) ? toSong(songRow(id)) : null)),
                songsPerRequest: 5,
                getAvailability: (song) => (song.id === 's-9' ? RESTRICTED : PLAYABLE),
                getReplacement: async (song) => (song.id === 's-9' ? { song: toSong(songRow('s-8')), label: i18n.key('song.replacement') } : null),
                getPlayedSong: async () => null,
                getPageUrl: (song) => `https://sample-source.invalid/song/${song.id}`,
            },
            'playback.audio@1': {
                audioQualityLevels: ['standard', 'high'],
                previewNotice: { 'zh-CN': '这是契约测试音源的试听片段', en: 'A preview clip of the contract test source' },
                getAudioSource: async (song, quality) => {
                    const row = songRow(song.id);
                    if (!row) throw sources.error('not-playable', `no audio for ${song.id}`);
                    return { url: toneUrl(row.tone), quality, expiresAt: Date.now() + 60 * 60 * 1000 };
                },
            },
            'reports@1': {
                canReport: (song) => Boolean(songRow(song.id)),
                report: async (song, report) => {
                    state.reports.push({ id: song.id, playedSeconds: report.playedSeconds });
                },
            },
            'lyrics@1': {
                crossSource: { linesOnly: false },
                getLyrics: async (song) => (songRow(song.id) ? lyricsOf(songRow(song.id)) : null),
                getChorusRanges: async () => [{ startTime: 3, endTime: 4.5 }],
                getSearchAlias: async (song) => ({ title: `${song.title} (sample)`, artist: song.artists[0]?.name ?? '' }),
                getAlternateArtistName: async (song) => (song.artists[0]?.id === 'ar-2' ? 'Lumen 三重奏' : null),
            },
            'auth@1': {
                getLoginStatus: async () => state.user,
                logout: async () => {
                    state.user = null;
                    save();
                },
                getLoginTexts: () => LOGIN_TEXTS,
                startLogin: async () => {
                    const key = `login-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
                    state.logins.set(key, 0);
                    return key;
                },
                createQr: async (key) => `data:image/svg+xml,${encodeURIComponent(qrPicture(key))}`,
                checkLogin: async (key) => {
                    if (!state.logins.has(key)) return { state: 'expired' };
                    const checks = state.logins.get(key) + 1;
                    state.logins.set(key, checks);
                    if (checks < 2) return { state: 'waiting' };
                    if (checks < 3) return { state: 'scanned' };
                    state.logins.delete(key);
                    state.user = await issueSession();
                    save();
                    return { state: 'confirmed' };
                },
                cancelLogin: async (key) => {
                    state.logins.delete(key);
                },
                getLoginTtlMs: () => 2 * 60 * 1000,
                getLoginDiagnostics: async () => [{ label: 'fixture.catalog', value: SONGS.length }],
            },
            'library@1': {
                getUserPlaylists: async (userId, limit, offset) => {
                    requireUser();
                    return page(state.playlists.filter((playlist) => playlist.owner === userId).map((playlist) => toPlaylist(playlist, state)), limit, offset);
                },
                getLikedSongIds: async () => {
                    requireUser();
                    return { ids: [...state.liked], whole: true };
                },
                getLikedSongCount: async () => (state.user ? state.liked.size : null),
                getUserAlbums: async (_userId, limit, offset) => page(ALBUMS.slice(0, 1).map(toAlbum), limit, offset),
            },
            'catalog@1': {
                getPlaylistTracks: async (id, limit, offset) => page(sourceSongs(playlistById(id)?.songs ?? []), limit, offset),
                getPlaylistDetail: async (id) => (playlistById(id) ? toPlaylist(playlistById(id), state) : null),
                getAlbumTracks: async (id, limit = 50, offset = 0) => page(SONGS.filter((row) => row.albumId === id).map(toSong), limit, offset),
                getAlbumDetail: async (id) => (albumOf(id) ? toAlbum(albumOf(id)) : null),
                getArtistSongs: async (id, limit, offset) => page(SONGS.filter((row) => row.artistId === id).map(toSong), limit, offset),
                getArtistAlbums: async (id, limit, offset) => page(ALBUMS.filter((album) => album.artist === id).map(toAlbum), limit, offset),
                getArtistDetail: async (id) => (artistOf(id) ? toArtist(artistOf(id)) : null),
                getSubscriptionStatus: async () => false,
            },
            'recommendations@1': {
                personalFmModes: false,
                getDailySongs: async () => sourceSongs(['s-3', 's-6', 's-9']),
                getPersonalFm: async () => sourceSongs(['s-2', 's-5']),
                getRecommendedCollections: async (limit) => state.playlists.slice(0, limit).map((playlist) => toPlaylist(playlist, state)),
            },
            'explore@1': {
                getFeed: async () => ({
                    sections: [
                        { id: 'new-albums', title: '新专辑', items: ALBUMS.map((album) => ({ kind: 'collection', collection: toAlbum(album) })) },
                        { id: 'songs', title: '今日推荐', items: sourceSongs(['s-1', 's-5', 's-8']).map((song) => ({ kind: 'song', song })), moreCursor: 'songs-more' },
                    ],
                }),
                getSectionItems: async (cursor) => (cursor === 'songs-more'
                    ? { items: sourceSongs(['s-2', 's-6']).map((song) => ({ kind: 'song', song })) }
                    : { items: [] }),
            },
            'mutations@1': {
                canAddToPlaylist: (playlist) => playlist.isOwned === true,
                likeSong: async (song, liked) => {
                    requireUser();
                    if (liked) state.liked.add(songIdOf(song));
                    else state.liked.delete(songIdOf(song));
                    save();
                },
                updatePlaylistTracks: async (operation, playlist, tracks) => {
                    requireUser();
                    const target = playlistById(playlist);
                    if (!target || target.owner !== 'fixture-user') throw sources.error('unsupported', 'only your own playlists change');
                    const ids = tracks.map(songIdOf);
                    target.songs = operation === 'add'
                        ? [...target.songs, ...ids.filter((id) => !target.songs.includes(id))]
                        : target.songs.filter((id) => !ids.includes(id));
                    save();
                },
                createPlaylist: async (name) => {
                    requireUser();
                    const playlist = { id: `pl-${state.playlists.length + 1}`, name, owner: 'fixture-user', songs: [] };
                    state.playlists.push(playlist);
                    save();
                    return toPlaylist(playlist, state);
                },
            },
            'covers@1': {
                hosts: [COVER_HOST],
                sized: (url, size) => (url.hostname === COVER_HOST ? `${url.origin}${url.pathname}?size=${size}` : null),
                identity: (url) => (url.hostname === COVER_HOST ? `sample-source:${url.pathname}` : null),
                original: (url) => (url.hostname === COVER_HOST ? `${url.origin}${url.pathname}` : null),
                requestedSize: (url) => (url.hostname === COVER_HOST ? Number(url.searchParams.get('size')) || null : undefined),
            },
            'raw@1': {
                backend: { name: 'sample-source-full', version: '1.0.0' },
                reservedParams: ['session'],
                describeEndpoint: (endpoint) => RAW_ENDPOINTS[endpoint] ?? null,
                request: async (endpoint, params) => ({ endpoint, params, catalog: SONGS.length }),
            },
            // A custom capability: the host does not read it, another mod takes it through folium.omni.capability.
            'x.sample-source-full.stats@1': {
                reportCount: () => state.reports.length,
            },
        },
    });

    // The second source: its songs play in a "player" of its own, a clock this file keeps.
    const player = { song: null, startedAt: 0, offsetMs: 0, playing: false };
    const positionMs = () => (player.playing ? player.offsetMs + (Date.now() - player.startedAt) : player.offsetMs);
    sources.register({
        id: 'fixture-external',
        displayName: { 'zh-CN': '契约测试音源（外部播放器）', en: 'Contract test source (external player)' },
        shortName: { 'zh-CN': '契约外放', en: 'Fixture external' },
        capabilities: {
            'search@1': {
                searchSongs: async (query, limit, offset) => page(SONGS.filter((row) => matches(query)(row.title)).map(toSong), limit, offset),
            },
            'songs@1': {
                getSong: async (id) => (songRow(id) ? toSong(songRow(id)) : null),
            },
            'playback.external@1': {
                canPlay: (song) => Boolean(songRow(song.id)),
                play: async (song, startSec) => {
                    Object.assign(player, { song: song.id, startedAt: Date.now(), offsetMs: startSec * 1000, playing: true });
                },
                pause: async () => {
                    player.offsetMs = positionMs();
                    player.playing = false;
                },
                resume: async () => {
                    player.startedAt = Date.now();
                    player.playing = true;
                },
                seek: async (seconds) => {
                    player.offsetMs = seconds * 1000;
                    player.startedAt = Date.now();
                },
                getStatus: async () => {
                    const durationMs = 6000;
                    const position = Math.min(positionMs(), durationMs);
                    return { mediaId: player.song ?? '', isPlaying: player.playing && position < durationMs, positionMs: position, durationMs, ended: position >= durationMs };
                },
                isStatusForSong: (song, status) => status.mediaId === song.id,
            },
        },
    });

    async function issueSession() {
        // The main entry hands out the session; without it (a test, a window with no bridge) the client makes one itself.
        try {
            return await folium.rpc.call('session.issue', 'Fixture Listener');
        } catch {
            return { id: 'fixture-user', nickname: 'Fixture Listener' };
        }
    }

    function qrPicture(key) {
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" fill="#fff"/><rect x="10" y="10" width="40" height="40" fill="#222"/><rect x="70" y="10" width="40" height="40" fill="#222"/><rect x="10" y="70" width="40" height="40" fill="#222"/><text x="60" y="66" font-size="9" text-anchor="middle">${key.slice(-6)}</text></svg>`;
    }

    folium.log.info(`registered ${handle.id} and its external player`);
    return () => {
        state.logins.clear();
    };
}

const AVAILABLE = Object.freeze({ configured: true });
const PLAYABLE = Object.freeze({ state: 'playable' });
const RESTRICTED = Object.freeze({ state: 'unknown', reason: 'restricted' });
const LOGIN_TEXTS = Object.freeze({
    title: { 'zh-CN': '登录契约测试音源', en: 'Sign in to the contract test source' },
    note: { 'zh-CN': '假的二维码：再检查两次就算登录成功。', en: 'A made-up code: it signs in after two more checks.' },
});
const RAW_ENDPOINTS = Object.freeze({
    echo: Object.freeze({ access: 'read' }),
    'playlist/rename': Object.freeze({ access: 'write' }),
    'login/cookie': Object.freeze({ access: 'denied' }),
});

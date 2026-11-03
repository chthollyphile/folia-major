import React, { useLayoutEffect, useState } from 'react';
import LyricMatchDialog from '../../src/components/modal/lyric-match/LyricMatchDialog';
import type { LocalSong, SongResult } from '../../src/types';
import type { NavidromeSong } from '../../src/types/navidrome';
import type { ProbeDefinition } from './definition';
// dev/probes/lyricMatchWindow.probe.tsx

/**
 * The window for matching lyrics by hand, for each kind of song: a local file, a song of an
 * online platform, a song of a Navidrome server.
 *
 * Every request the window makes while this probe is mounted is answered here, by a fake `fetch`:
 * no music service is reached. The covers are pictures drawn in this file.
 *
 * Opened by hand: ?probe=lyricMatchWindow&kind=local|online|navidrome&theme=dark|light
 * &scenario=ok|loading|empty|searchError. A test passes the same three as props.
 * In `ok`, the song "Blue Hours" has a lyric that fails to load and "Blue Hour (Demo)" has none;
 * a search for text that contains "more" gives a long list.
 */
type Kind = 'local' | 'online' | 'navidrome';
type Scenario = 'ok' | 'loading' | 'empty' | 'searchError';
// `run`: a test changes it to get a newly mounted window for the same three.
type ProbeProps = { kind?: Kind; theme?: 'dark' | 'light'; scenario?: Scenario; run?: number };

const cover = (from: string, to: string) => `data:image/svg+xml;base64,${btoa(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`
    + `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>`
    + `<rect width="64" height="64" fill="url(#g)"/><circle cx="32" cy="32" r="14" fill="rgba(255,255,255,0.35)"/></svg>`,
)}`;

const SONG_COVER = cover('#1d4ed8', '#0f172a');
const ARTIST = { id: 1, name: 'Mira Lane' };

const rawSong = (id: number, name: string, artist: string, album: string, dt: number, picUrl?: string) => ({
    id, name, ar: [{ id: id * 10, name: artist }], al: { id: id * 100, name: album, picUrl }, dt,
});

const FOUND = [
    rawSong(101, 'Blue Hour (Live)', 'Mira Lane', 'Night Windows', 215000, cover('#be123c', '#4c0519')),
    rawSong(102, 'Blue Hour', 'Mira Lane Trio', 'Late Sessions', 198000, cover('#047857', '#022c22')),
    rawSong(103, 'Blue Hours', 'The Lanes', 'Hours', 180000),
    rawSong(104, 'Blue Hour (Demo)', 'Mira Lane', 'Rough Cuts', 201000, cover('#a16207', '#422006')),
];
const FOUND_MORE = Array.from({ length: 12 }, (_, index) => rawSong(
    201 + index, `Blue Hour, take ${index + 1}`, 'Mira Lane', `Night Windows, disc ${index + 1}`, 215000 + index * 4000,
    index % 3 === 2 ? undefined : cover(['#7c3aed', '#0e7490', '#b45309'][index % 3], '#111827'),
));

const LYRIC = [
    '[00:00.00]The street lamps hum before the dark',
    '[00:06.00]A blue hour settles on the park',
    '[00:12.00]We count the windows, one by one',
].join('\n');
const LYRIC_TRANSLATION = [
    '[00:00.00]路灯在天黑之前低声作响',
    '[00:06.00]蓝色的时刻落在公园里',
    '[00:12.00]我们一扇一扇地数着窗',
].join('\n');

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
});

// What the fake answers with: set by the probe before the window mounts.
let scenario: Scenario = 'ok';

// Every request the window made, in order: read from the page as window.__lyricMatchProbeRequests.
const requests: string[] = [];
(window as unknown as { __lyricMatchProbeRequests?: string[] }).__lyricMatchProbeRequests = requests;

const fakeFetch: typeof fetch = async (input) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href);
    requests.push(`${url.pathname}${url.search.replace(/timestamp=\d+/, 'timestamp=T')}`);
    if (url.pathname.endsWith('/register/anonimous')) return json({ code: 200, cookie: 'MUSIC_A=probe' });
    if (url.pathname.endsWith('/cloudsearch')) {
        if (scenario === 'loading') return new Promise<Response>(() => {});
        if (scenario === 'searchError') return new Response('probe: the search failed', { status: 500 });
        const songs = scenario === 'empty' ? [] : (url.searchParams.get('keywords') ?? '').includes('more') ? FOUND_MORE : FOUND;
        return json({ code: 200, result: { songs, songCount: songs.length } });
    }
    if (url.pathname.endsWith('/lyric/new')) {
        const id = url.searchParams.get('id');
        if (id === '103') return new Response('probe: the lyric failed', { status: 500 });
        if (id === '104') return json({ code: 200, lrc: { lyric: '' } });
        return json({ code: 200, lrc: { lyric: LYRIC }, tlyric: { lyric: LYRIC_TRANSLATION } });
    }
    if (url.pathname.endsWith('/song/chorus')) return json({ code: 200, chorus: [] });
    console.warn('[LyricMatchProbe] No fake answer for', url.pathname);
    return json({}, 404);
};

const LOCAL_SONG: LocalSong = {
    id: 'probe-local-song',
    fileName: 'Mira Lane - Blue Hour.flac',
    filePath: 'Music/Mira Lane - Blue Hour.flac',
    duration: 215000,
    fileSize: 31_000_000,
    mimeType: 'audio/flac',
    addedAt: 0,
    title: 'Blue Hour',
    titleOrigin: 'import',
    importedMetadata: { title: 'Blue Hour', titleSource: 'embedded', artistNames: ['Mira Lane'], albumName: 'Night Windows' },
    hasEmbeddedLyrics: true,
};

const ONLINE_SONG: SongResult = {
    id: 555,
    name: 'Blue Hour',
    artists: [ARTIST],
    album: { id: 11, name: 'Night Windows', coverUrl: SONG_COVER },
    durationMs: 215000,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: '555' },
};

const NAVIDROME_SONG = {
    id: 'probe-navidrome-song',
    name: 'Blue Hour',
    artists: [ARTIST],
    album: { id: 11, name: 'Night Windows' },
    durationMs: 215000,
    isNavidrome: true,
    navidromeData: { id: 'probe-navidrome-song', streamUrl: '', coverArtUrl: SONG_COVER, albumId: 'album', artistId: 'artist', path: '', suffix: 'flac' },
} as unknown as NavidromeSong;

const readUrl = (): ProbeProps => {
    const params = new URLSearchParams(window.location.search);
    return {
        kind: (params.get('kind') as Kind | null) ?? undefined,
        theme: (params.get('theme') as 'dark' | 'light' | null) ?? undefined,
        scenario: (params.get('scenario') as Scenario | null) ?? undefined,
    };
};

const LyricMatchWindowProbe: React.FC<ProbeProps> = (props) => {
    const fromUrl = readUrl();
    const kind = props.kind ?? fromUrl.kind ?? 'local';
    const isDaylight = (props.theme ?? fromUrl.theme ?? 'dark') === 'light';
    const wanted = props.scenario ?? fromUrl.scenario ?? 'ok';
    const [closed, setClosed] = useState('');
    // The window searches as it mounts, so the fake is in place before it is rendered.
    const [fakeFor, setFakeFor] = useState<string | null>(null);
    const mountKey = `${kind}-${isDaylight}-${wanted}-${props.run ?? 0}`;

    useLayoutEffect(() => {
        const realFetch = window.fetch;
        scenario = wanted;
        window.fetch = fakeFetch;
        // The lyric preview follows the app's playback clock: here it stands at 7 s, in the second line.
        const globals = window as unknown as { __folia_current_time?: unknown };
        const realClock = globals.__folia_current_time;
        globals.__folia_current_time = { get: () => 7, on: () => () => {} };
        setFakeFor(mountKey);
        return () => {
            window.fetch = realFetch;
            globals.__folia_current_time = realClock;
        };
    }, [mountKey, wanted]);

    const common = { isDaylight, onClose: () => setClosed('closed'), onMatch: async () => setClosed('matched') };

    return (
        <div className={`min-h-screen p-10 ${isDaylight ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-950 text-zinc-100'}`}>
            {/* Something behind the window, so that a picture shows how much the backdrop blurs and dims. */}
            <div className="grid grid-cols-6 gap-6">
                {Array.from({ length: 18 }, (_, index) => (
                    <div key={index} className="h-32 rounded-2xl p-4 text-lg font-bold text-white" style={{ background: ['#2563eb', '#db2777', '#059669', '#d97706'][index % 4] }}>
                        Card {index + 1}
                    </div>
                ))}
            </div>
            <output data-testid="lyric-match-outcome">{closed}</output>
            {fakeFor === mountKey && (
                <React.Fragment key={mountKey}>
                    {kind === 'local' && <LyricMatchDialog kind="local" song={LOCAL_SONG} onPureMusicMarkChanged={() => {}} {...common} />}
                    {kind === 'online' && <LyricMatchDialog kind="online" song={ONLINE_SONG} {...common} />}
                    {kind === 'navidrome' && <LyricMatchDialog kind="navidrome" song={NAVIDROME_SONG} {...common} />}
                </React.Fragment>
            )}
        </div>
    );
};

const probe: ProbeDefinition = {
    id: 'lyricMatchWindow',
    title: '手动匹配歌词的窗口',
    description: '本地、在线、Navidrome 三种歌曲的匹配窗口；搜索和歌词都由假的 fetch 回答。?kind=local|online|navidrome&theme=dark|light&scenario=ok|loading|empty|searchError',
    Component: LyricMatchWindowProbe,
};

export default probe;

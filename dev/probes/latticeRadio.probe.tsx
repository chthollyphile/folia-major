import { useEffect, useLayoutEffect, useState } from 'react';
import { useMotionValue } from 'framer-motion';
import Lattice from '../../src/components/app/lattice/Lattice';
import { PlayerState, type Line, type SongResult } from '../../src/types';
import type { ProbeDefinition } from './definition';
import { DAYLIGHT_THEME, DEFAULT_THEME } from '../../src/services/baseThemes';
import type { Theme } from '../../src/types';
import { buildAppStyle } from '../../src/components/app/presentation/buildAppStyle';
import { useAppViewStore } from '../../src/stores/useAppViewStore';
import { useLatticeSettingsStore } from '../../src/stores/useLatticeSettingsStore';
import { usePlaybackStore } from '../../src/stores/usePlaybackStore';

// dev/probes/latticeRadio.probe.tsx
// 私人 FM 下的 Lattice（电台墙）：本地模拟一个电台。队列每次走到最后两首时追加三首（像 FM 续歌），
// 「不喜欢」切到下一首；封面是内联的 SVG 色块，取色不碰网络。

const HUES = [12, 48, 96, 168, 204, 248, 292, 330];

// ?rasterCovers：换成 1200 px、带噪点的 JPEG（和真实封面的最大档一样大），看卡片变大时光栅化的开销。
const RASTER_COVERS = new URLSearchParams(location.search).has('rasterCovers');
const rasterCovers = new Map<number, string>();
const rasterCover = (hue: number) => {
    const cached = rasterCovers.get(hue);
    if (cached) return cached;
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 1200;
    const context = canvas.getContext('2d');
    if (!context) return '';
    const gradient = context.createLinearGradient(0, 0, 1200, 1200);
    gradient.addColorStop(0, `hsl(${hue},70%,62%)`);
    gradient.addColorStop(1, `hsl(${(hue + 40) % 360},60%,28%)`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, 1200, 1200);
    const noise = context.getImageData(0, 0, 1200, 1200);
    for (let offset = 0; offset < noise.data.length; offset += 4) {
        const grain = (Math.random() - 0.5) * 60;
        noise.data[offset] += grain;
        noise.data[offset + 1] += grain;
        noise.data[offset + 2] += grain;
    }
    context.putImageData(noise, 0, 0);
    const url = canvas.toDataURL('image/jpeg', 0.9);
    rasterCovers.set(hue, url);
    return url;
};

// 一开始就画好，免得续歌那一下在画封面上卡住，混进要量的帧里。
if (RASTER_COVERS) HUES.forEach(rasterCover);

const coverFor = (index: number) => {
    const hue = HUES[index % HUES.length];
    if (RASTER_COVERS) return rasterCover(hue);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`
        + `<stop offset="0" stop-color="hsl(${hue},70%,62%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},60%,28%)"/></linearGradient></defs>`
        + `<rect width="300" height="300" fill="url(#g)"/><circle cx="210" cy="90" r="46" fill="hsl(${(hue + 180) % 360},60%,70%)" opacity="0.7"/></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

const songAt = (index: number): SongResult => ({
    id: `fm-${index}`, name: `Radio song ${index + 1}`, artists: [{ id: 1, name: `Artist ${index % 5 + 1}` }],
    album: { id: 1, name: 'Album', coverUrl: coverFor(index) }, durationMs: 200000,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: `fm-${index}` },
});

const batchFrom = (start: number) => [songAt(start), songAt(start + 1), songAt(start + 2)];

// 墙上的颜色都来自应用外壳写的主题变量（buildAppStyle）：轮换几套主题看强调色跟着换。
const THEMES: Theme[] = [
    DEFAULT_THEME,
    { ...DEFAULT_THEME, name: 'Teal accent', accentColor: '#2dd4bf' },
    { ...DEFAULT_THEME, name: 'Violet accent', accentColor: '#a78bfa', secondaryColor: '#7c3aed' },
];

const lyricLines: Line[] = [
    { startTime: 0, endTime: 60, fullText: '电台在夜里慢慢转 The radio turns slowly at night', words: [
        { text: '电台在夜里慢慢转', startTime: 0, endTime: 30 },
        { text: ' The radio turns slowly at night', startTime: 30, endTime: 60 },
    ] },
];

function LatticeRadioProbe() {
    const time = useMotionValue(42);
    const [songs, setSongs] = useState<SongResult[]>(() => batchFrom(0));
    const [currentSong, setCurrentSong] = useState<SongResult | null>(songs[0]);
    const [isFmMode, setIsFmMode] = useState(true);
    const [loopMode, setLoopMode] = useState<'off' | 'all' | 'one'>('off');
    const [plays, setPlays] = useState<string[]>([]);
    const [dislikes, setDislikes] = useState(0);
    const [toggles, setToggles] = useState(0);
    const [playerState, setPlayerState] = useState(PlayerState.PLAYING);
    const [themeIndex, setThemeIndex] = useState(1);
    const theme = THEMES[themeIndex];
    const appStyle = buildAppStyle({ bgMode: 'theme', isDaylight: false, theme, daylightTheme: DAYLIGHT_THEME, defaultTheme: DEFAULT_THEME });

    useLayoutEffect(() => {
        useAppViewStore.setState({ view: 'lattice', latticeSource: 'queue' });
    }, []);
    useEffect(() => {
        usePlaybackStore.setState({ currentSong, isFmMode });
    }, [currentSong, isFmMode]);

    // FM 续歌：走到最后两首时先追加一批，再往下走一首。
    const next = () => {
        const index = songs.findIndex(song => song.id === currentSong?.id);
        const queue = isFmMode && index >= songs.length - 2 ? [...songs, ...batchFrom(songs.length)] : songs;
        if (queue !== songs) setSongs(queue);
        if (index + 1 < queue.length) setCurrentSong(queue[index + 1]);
    };
    const prev = () => {
        const index = songs.findIndex(song => song.id === currentSong?.id);
        if (index > 0) setCurrentSong(songs[index - 1]);
    };

    return <div style={{ ...appStyle, height: '100vh' }} data-plays={plays.join(',')} data-dislikes={dislikes} data-toggles={toggles}>
        <Lattice lyrics={{ lines: lyricLines }} controls={{ loopMode,
            playback: { prev, next,
                // FM 里只在不循环 / 单曲循环之间切（#1225）；普通队列三态轮换。
                toggleLoop: () => setLoopMode(value => (isFmMode
                    ? value === 'off' ? 'one' : 'off'
                    : value === 'off' ? 'all' : value === 'all' ? 'one' : 'off')),
                shuffleQueue: () => {}, toggleSongLike: () => {}, isSongLiked: false, isFmMode },
            invokeCommandById: () => {}, canInvokeCommandById: command => command !== 'queue',
            fmDislike: () => { setDislikes(value => value + 1); next(); },
        }} queue={songs} currentSong={currentSong} playerState={playerState}
        lyricSource={{ currentTime: time, currentLineIndex: 0, lines: lyricLines, theme }} lyricKeywordColoringEnabled
        currentTime={time} lyricCurrentTime={time} playbackDuration={200} canTogglePlayback isDaylight={false}
        onBack={() => {}} onOpenPlayer={() => {}}
        onPlaySong={(song, _queue, asFm) => { setPlays(value => [...value, `${song.id}:${asFm ? 'fm' : 'queue'}`]); setCurrentSong(song); }}
        onTogglePlayback={() => { setToggles(value => value + 1); setPlayerState(value => value === PlayerState.PLAYING ? PlayerState.PAUSED : PlayerState.PLAYING); }}
        onSeek={() => {}} />
        <div style={{ position: 'fixed', right: 0, top: 0, zIndex: 100 }}>
            <button onClick={next}>Next track</button>
            <button onClick={prev}>Previous track</button>
            <button onClick={() => setIsFmMode(value => !value)}>Toggle FM</button>
            <button onClick={() => { setSongs(batchFrom(100)); setCurrentSong(songAt(100)); }}>Switch FM mode</button>
            <button onClick={() => setThemeIndex(value => (value + 1) % THEMES.length)}>Cycle theme</button>
            {/* 普通队列用哪种墙（设置里的「墙面形态」）；私人 FM 下不看它。 */}
            <button onClick={() => {
                const settings = useLatticeSettingsStore.getState();
                settings.handleSetLatticeWallForm(settings.latticeWallForm === 'radio' ? 'poster' : 'radio');
            }}>Toggle wall form</button>
        </div>
    </div>;
}

export default {
    id: 'latticeRadio', title: 'Lattice radio wall',
    description: 'Personal FM on Lattice: one row of cards, dealt and flipped as a simulated radio tops up its queue.',
    Component: LatticeRadioProbe,
} satisfies ProbeDefinition;

import type { LibraryHomeCard } from '../../../src/library/core/home/homeModel.contract';
import type { BravaisLayer } from '../../../src/library/suites/bravais/bravaisLayer';
import { projectCollectionTracks, projectHomeCards, type TrackDescription } from '../../../src/library/suites/bravais/bravaisProjection';
import type { SongResult } from '../../../src/types';

// dev/probes/bravais-perf/perfLayers.ts
// 性能探针喂给真实 BravaisStage 的层描述。数据是合成的（不发请求、不经 core），但走的是 surface 用的同一套投影
// （projectCollectionTracks / projectHomeCards），形状与真实层一致：
// - 集合层：N 首曲目的无限拼贴，和「过滤中」的有限拼贴（每 7 首留 1 首，planCount 仍是全量 N）——两者只差 mode / items /
//   wall.filterKey，stage 判成 filter，从缝的两侧边缘整面翻；
// - 首页层：歌单 / 专辑两个页签（层 key home:playlist / home:albums），换页签是整墙出场 → 入场。
// 封面是画布生成的 JPEG（blob URL），数量有限、在墙上循环出现，解码成本接近真实封面而不受网络影响。

const COVER_COUNT = 64;
const COVER_PX = 300;

let coversPromise: Promise<string[]> | null = null;

/** 生成一组确定的封面（渐变 + 圆斑，JPEG）。整页只生成一次。 */
export const loadPerfCovers = (): Promise<string[]> => {
    coversPromise ??= Promise.all(Array.from({ length: COVER_COUNT }, (_, index) => new Promise<string>((resolve) => {
        const canvas = document.createElement('canvas');
        canvas.width = COVER_PX;
        canvas.height = COVER_PX;
        const context = canvas.getContext('2d')!;
        const hue = (index * 137) % 360;
        const gradient = context.createLinearGradient(0, 0, COVER_PX, COVER_PX);
        gradient.addColorStop(0, `hsl(${hue} 70% 45%)`);
        gradient.addColorStop(1, `hsl(${(hue + 60) % 360} 60% 18%)`);
        context.fillStyle = gradient;
        context.fillRect(0, 0, COVER_PX, COVER_PX);
        for (let shape = 0; shape < 6; shape += 1) {
            context.fillStyle = `hsl(${(hue + shape * 40) % 360} 80% ${30 + shape * 8}% / .55)`;
            context.beginPath();
            context.arc(40 + ((index * 53 + shape * 71) % 220), 40 + ((index * 31 + shape * 97) % 220), 20 + shape * 11, 0, Math.PI * 2);
            context.fill();
        }
        canvas.toBlob(blob => resolve(blob ? URL.createObjectURL(blob) : ''), 'image/jpeg', 0.86);
    })));
    return coversPromise;
};

const ARTISTS = ['Aurora Lane', '青木 遥', 'The Driftwood', 'Mira Sol', '夜航星', 'Kestrel'];
const NOOP = () => { };
const EMPTY_KEYS: ReadonlySet<string> = new Set();

/** 合成曲目：每首各自一个 id，封面按专辑（每 8 首一张专辑）循环。 */
const makeTracks = (count: number): SongResult[] => Array.from({ length: count }, (_, index) => ({
    id: 2_000_000 + index,
    name: `Perf Track ${index + 1}`,
    artists: [{ id: index % ARTISTS.length, name: ARTISTS[index % ARTISTS.length]! }],
    album: { id: Math.floor(index / 8), name: `Album ${Math.floor(index / 8) + 1}` },
    durationMs: 150_000 + (index % 120) * 1000,
}) as unknown as SongResult);

export type PerfCollectionLayers = { all: BravaisLayer; filtered: BravaisLayer };

/** 集合层：无限拼贴（全部）与有限拼贴（过滤中）。条目投影在这里做一次（真实 surface 也在数据到达时投影一次）。 */
export const buildCollectionLayers = (count: number, covers: readonly string[]): PerfCollectionLayers => {
    const tracks = makeTracks(count);
    const describe = (track: SongResult): TrackDescription => {
        const albumId = Number((track.album as { id: number }).id);
        return {
            artists: track.artists.map(artist => artist.name),
            album: track.album.name ?? '',
            coverUrl: covers[albumId % covers.length] || undefined,
            durationMs: track.durationMs,
            playbackKey: `perf:${track.id}`,
            unavailable: false,
        };
    };
    const items = projectCollectionTracks(tracks, index => `perf-${index}-0`, describe, 'Unknown');
    const base: BravaisLayer = {
        key: `perf:collection:${count}`,
        sessionKey: `perf:collection:${count}`,
        surface: 'collection',
        mode: 'infinite',
        items,
        seam: { title: `Perf Playlist · ${count}`, crumb: 'Perf Playlist', meta: `${count} tracks` },
        isInteractive: true,
        focusedEntryKey: null,
        nowPlayingKey: items[2]?.key ?? null,
        queuedKeys: EMPTY_KEYS,
        onPlayItem: NOOP,
        onEnqueueItem: NOOP,
        onBack: NOOP,
        onDone: NOOP,
    };
    const matched = items.filter((_, index) => index % 7 === 0);
    return {
        all: base,
        filtered: {
            ...base,
            mode: 'finite',
            items: matched,
            seam: { ...base.seam, meta: `${matched.length} / ${count}` },
            wall: { planCount: count, filterKey: 'perf' },
        },
    };
};

export type PerfHomeTab = 'playlist' | 'albums';

/** 首页层：两个页签各 N 张卡片（歌单 / 专辑），缝里列出页签，onSelectTab 由探针接（换页签就是换层）。 */
export const buildHomeLayers = (
    count: number,
    covers: readonly string[],
    onSelectTab: (key: string) => void,
): Record<PerfHomeTab, BravaisLayer> => {
    const labels = { kindLabel: (kind: string) => kind, trackCount: (value: number) => `${value} tracks` };
    const cardsFor = (type: 'playlist' | 'album'): LibraryHomeCard[] => Array.from({ length: count }, (_, index) => ({
        id: `${type}-${index}`,
        name: `${type === 'album' ? 'Album' : 'Playlist'} ${index + 1}`,
        type,
        coverUrl: covers[(index * 7 + (type === 'album' ? 11 : 0)) % covers.length] || undefined,
        trackCount: 10 + (index % 90),
    }));
    const layerFor = (tab: PerfHomeTab): BravaisLayer => ({
        key: `home:${tab}`,
        sessionKey: 'perf:home',
        surface: 'home',
        mode: 'infinite',
        items: projectHomeCards(cardsFor(tab === 'albums' ? 'album' : 'playlist'), labels),
        seam: {
            title: 'Library',
            crumb: 'Library',
            meta: `${count} cards`,
            tabs: (['playlist', 'albums'] as const).map(key => ({ key, label: key, active: key === tab, disabled: false })),
            onSelectTab,
        },
        isInteractive: true,
        focusedEntryKey: null,
        nowPlayingKey: null,
        queuedKeys: EMPTY_KEYS,
        onOpenItem: NOOP,
    });
    return { playlist: layerFor('playlist'), albums: layerFor('albums') };
};

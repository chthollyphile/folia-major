import type { LatticeTile, WallEntryKind } from '../../../components/app/lattice/latticeModel';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';
import { summaryOfSection } from '../../../components/app/lattice/exploreWall';
import type { WallSection } from '../../../components/app/lattice/wallLayout';
import type { BravaisItem, BravaisItemKind } from './bravaisLayer';
import type { OmniExploreSection } from '../../../types/onlineMusic';
import type { BravaisHomeShortcut } from './bravaisHomeModels';
import { resolveLibraryHomeSpecial } from '../../core/home/homeSpecialCards';
import { formatDuration } from './bravaisProjection';

// src/library/suites/bravais/bravaisExploreProjection.ts
// 探索页签的纯投影：网格探索墙的条目（lattice/exploreWall 的 buildExploreTiles，经 useExploreWall 交来，同一份数据、同一个
// 去重与顺序）→ 墙上的磁贴；每个有条目的 section → 一张标题磁贴（序号「01 / 12」、标题、「12 · 专辑 · 歌曲」，与网格的
// 标题磁贴 LatticeHeading 同样的字）。排法不在这里：层带上 sections，墙按探索形状铺（bravaisWallShape）。

const KIND_OF_ENTRY: Record<WallEntryKind, BravaisItemKind> = {
    album: 'album',
    playlist: 'playlist',
    mix: 'playlist',
    artist: 'artist',
    song: 'track',
};

/**
 * 探索条目 → 磁贴。key 是条目的 id（歌曲是播放键，集合是 `collection:<类型>:<id>`，本机两组里的歌是 `<组 id>:<播放键>`，
 * 见 buildExploreTiles）；playbackKey 总是歌曲自己的播放键；徽标是种类（探索页的词）。
 */
export const projectExploreItems = (tiles: readonly LatticeTile[]): BravaisItem[] => tiles.map((tile) => {
    const item: BravaisItem = {
        key: tile.id,
        kind: tile.kind === 'song' ? 'track' : KIND_OF_ENTRY[tile.entryKind ?? 'playlist'],
        title: tile.title,
        subtitle: tile.artist,
        coverUrl: tile.coverUrl,
        badge: tile.label ?? '',
        ...(tile.kind === 'collection' && tile.collection.coverOverlay ? { coverOverlay: tile.collection.coverOverlay } : {}),
    };
    if (tile.kind !== 'song') return item;
    const { song } = tile;
    return {
        ...item,
        playbackKey: getPlaybackSongKey(song),
        album: song.album?.name,
        artists: song.artists?.map(artist => artist.name) ?? [],
        durationLabel: formatDuration(song.durationMs),
    };
});

const twoDigits = (value: number) => String(value).padStart(2, '0');

/** Featured actions also stay reachable from the Explore seam when the wall has been panned. */
export const projectExploreShortcuts = (
    tiles: readonly LatticeTile[],
    sections: readonly OmniExploreSection[],
): Array<Omit<BravaisHomeShortcut, 'open'>> => {
    const first = new Set(sections.filter(section => section.placement === 'first').map(section => section.id));
    const seen = new Set<string>();
    return tiles.flatMap(tile => {
        if (tile.kind !== 'collection' || !first.has(tile.sectionKey ?? '')) return [];
        const { collection } = tile;
        const special = resolveLibraryHomeSpecial({ id: collection.id, type: collection.type, raw: collection }, 'online');
        if (!special || seen.has(special)) return [];
        seen.add(special);
        return [{ special, label: collection.name, shortLabel: collection.name, pinned: true, itemKey: tile.id, direct: Boolean(collection.personalFm) }];
    });
};

/** 每个 section 的标题磁贴（按 section 的序号，与探索形状的 headingAt 对上）。 */
export const projectExploreHeadings = (sections: readonly WallSection[], t: (key: string) => string): BravaisItem[] => (
    sections.map((section, index) => ({
        key: `heading:${section.key}`,
        kind: 'feed',
        title: section.heading,
        subtitle: summaryOfSection(section, t),
        badge: `${twoDigits(index + 1)} / ${twoDigits(sections.length)}`,
    }))
);

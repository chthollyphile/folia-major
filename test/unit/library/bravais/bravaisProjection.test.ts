import { describe, expect, it } from 'vitest';
import type { SongResult } from '@/types';
import type { LibraryHomeCard } from '@/library/core/home/homeModel.contract';
import {
    collectQueuedKeys,
    findNowPlayingKey,
    formatEntryBadge,
    homeCardItemKey,
    homeCardKind,
    projectCollectionTracks,
    projectHomeCards,
    type TrackDescription,
} from '@/library/suites/bravais/bravaisProjection';

// test/unit/library/bravais/bravaisProjection.test.ts
// core 数据 → 磁贴条目的纯投影：首页卡片的 key 与种类、集合曲目的条目键 / 序号 / 聚焦卡字段、正在播放与已在队列。

const card = (id: string | number, type?: string, extra: Partial<LibraryHomeCard> = {}): LibraryHomeCard => ({ id, name: `Card ${id}`, type, ...extra });

describe('home cards', () => {
    it('keys cards apart from collection entries and maps their kind', () => {
        expect(homeCardItemKey(card(7, 'playlist'))).toBe('card:playlist:7');
        expect(homeCardItemKey(card('x'))).toBe('card:item:x');
        expect(homeCardKind('album')).toBe('album');
        expect(homeCardKind('daily_recommendations')).toBe('feed');
        expect(homeCardKind('radio')).toBe('feed');
        expect(homeCardKind(undefined)).toBe('playlist');
    });

    it('folds a collection track count into the kind label instead of the subtitle', () => {
        const items = projectHomeCards([
            card(1, 'playlist', { trackCount: 12, description: 'Curator', coverUrl: 'cover.jpg' }),
            card(2, 'album', { description: 'Artist' }),
            card(3, 'artist', { trackCount: 7, description: 'Artists' }),
            card(4, 'radio', { trackCount: 0 }),
        ], { kindLabel: kind => `[${kind}]`, trackCount: count => `${count} tracks` });
        expect(items).toEqual([
            { key: 'card:playlist:1', kind: 'playlist', title: 'Card 1', subtitle: 'Curator', coverUrl: 'cover.jpg', badge: '[playlist] · 12', trackCountLabel: '12 tracks' },
            { key: 'card:album:2', kind: 'album', title: 'Card 2', subtitle: 'Artist', coverUrl: undefined, badge: '[album]' },
            // 歌手不是集合：曲目数仍在副标题里（墙上歌手的副标题不显示，可访问名里还在）。
            { key: 'card:artist:3', kind: 'artist', title: 'Card 3', subtitle: '7 tracks · Artists', coverUrl: undefined, badge: '[artist]' },
            // 每日推荐类的 feed 是集合，但曲目数未知（0）时标签只写种类。
            { key: 'card:radio:4', kind: 'feed', title: 'Card 4', subtitle: '', coverUrl: undefined, badge: '[feed]' },
        ]);
    });
});

describe('collection tracks', () => {
    const tracks = [{ name: 'One' }, { name: 'Two' }, { name: 'Three' }] as unknown as SongResult[];
    const describe_ = (track: SongResult): TrackDescription => ({
        artists: track.name === 'Two' ? [] : ['Singer A', 'Singer B'],
        album: track.name === 'Three' ? '' : 'Album',
        coverUrl: `${track.name}.jpg`,
        durationMs: track.name === 'One' ? 185_000 : 0,
        playbackKey: `key:${track.name}`,
        unavailable: track.name === 'Three',
    });

    it('keys items by entry key, numbers them and carries the focus card fields', () => {
        const items = projectCollectionTracks(tracks, index => (index === 1 ? null : `entry-${index}`), describe_, 'Unknown');
        expect(items.map(item => item.key)).toEqual(['entry-0', 'entry-2']);
        expect(items[0]).toMatchObject({
            kind: 'track',
            title: 'One',
            subtitle: 'Singer A, Singer B',
            badge: '01',
            badgeIsIndex: true,
            playbackKey: 'key:One',
            album: 'Album',
            artists: ['Singer A', 'Singer B'],
            durationLabel: '3:05',
        });
        expect(items[1]).toMatchObject({ badge: '03', album: undefined, durationLabel: '', unavailable: true });
    });

    it('falls back to the album, then the unknown-artist label, for the subtitle', () => {
        const items = projectCollectionTracks(tracks.slice(1, 2), index => `entry-${index}`, describe_, 'Unknown');
        expect(items[0].subtitle).toBe('Album');
    });

    it('pads the badge to the width of the total', () => {
        expect(formatEntryBadge(0, 9)).toBe('01');
        expect(formatEntryBadge(4, 120)).toBe('005');
    });

    it('finds the playing entry and the queued ones by playback key', () => {
        const items = projectCollectionTracks(tracks, index => `entry-${index}`, describe_, 'Unknown');
        expect(findNowPlayingKey(items, 'key:Two')).toBe('entry-1');
        expect(findNowPlayingKey(items, null)).toBeNull();
        expect([...collectQueuedKeys(items, new Set(['key:One', 'key:Three', 'key:Other']))]).toEqual(['entry-0', 'entry-2']);
    });
});

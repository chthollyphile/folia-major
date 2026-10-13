import { describe, expect, it } from 'vitest';
import type { UnifiedSong } from '@/types';
import { buildDiscoverSongCardId, dedupeDiscoverSongs, type DiscoverSection } from '@/library/core/model/discoverSections';

// test/unit/discoverSongCards.test.ts
// 2026-10-08 实测复现的回归：发现页四段之间没有去重，同一首歌会同时出现在猜你喜欢和雷达里。
// 只按 mediaId 编卡片 id 会让 React 撞 same key —— 它不抛异常，而是随机丢弃/错位子节点
// （"children to be duplicated and/or omitted"），现象是往后拉时卡片消失、变空块、位置乱跳。

const song = (mediaId: string): UnifiedSong => ({
    id: mediaId,
    name: `Song ${mediaId}`,
    artists: [],
    album: { id: mediaId, name: `Album ${mediaId}` },
    durationMs: 1,
    sourceRef: { kind: 'online', providerId: 'qq', mediaId },
});

const section = (id: DiscoverSection['id'], songs: UnifiedSong[]): DiscoverSection => ({
    id,
    title: id,
    songs,
});

describe('discover song card ids', () => {
    it('prefixes the card id with the section so the same song in two sections never collides', () => {
        const same = song('001UXjQ4PH9Lw');
        // 修好前：两个都是 `discover-song-001UXjQ4PH9Lw` → React 同键告警 + 卡片错位
        expect(buildDiscoverSongCardId('personal-fm', same))
            .not.toBe(buildDiscoverSongCardId('radar', same));
    });

    it('emits unique ids across every section after dedupe', () => {
        const sections = dedupeDiscoverSongs([
            section('personal-fm', [song('A'), song('B')]),
            section('radar', [song('B'), song('C')]),
            section('new-songs', [song('A')]),
        ]);
        const ids = sections.flatMap(s =>
            s.songs.map(song => buildDiscoverSongCardId(String(s.id), song)),
        );
        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe('dedupeDiscoverSongs', () => {
    it('keeps the first section a song appears in and drops the later copies', () => {
        const sections = dedupeDiscoverSongs([
            section('personal-fm', [song('A')]),
            section('radar', [song('A'), song('B')]),
        ]);
        expect(sections[0].songs.map(s => s.id)).toEqual(['A']);
        expect(sections[1].songs.map(s => s.id)).toEqual(['B']);
    });

    it('leaves already-unique sections untouched (identity preserved)', () => {
        const original = section('radar', [song('A'), song('B')]);
        const [result] = dedupeDiscoverSongs([original]);
        expect(result).toBe(original);
    });

    it('keeps every playable song available somewhere', () => {
        const sections = dedupeDiscoverSongs([
            section('personal-fm', [song('A'), song('B')]),
            section('radar', [song('B'), song('C')]),
        ]);
        const kept = new Set(sections.flatMap(s => s.songs.map(song => song.id)));
        expect([...kept].sort()).toEqual(['A', 'B', 'C']);
    });
});

import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { UNTAGGED_GROUP_KEY, buildSongNoteTagGroups, songNoteChipLine } from '@/components/app/scratchpad/commentCards';
import type { SongNoteRow, SongNoteTag } from '@/components/song-notes/songNotesModel';
import { buildSongNoteTagCommands, songNoteTagCommandId } from '@/components/command-palette/songNoteTagCommandsInstaller';
import { resolveHomeWallMode } from '@/library/suites/bravais/bravaisHomeProjection';
import type { SongResult } from '@/types';

// test/unit/song-notes/songNoteTagGroups.test.ts
// 「时刻」展开整页按标签分组、另外三页卡片上那一小行、命令 #标签、首页标签页签的有限墙。

const row = (key: string, tags: Record<string, number>, updatedAt: number, commentCount = 0): SongNoteRow => ({
    key,
    song: { id: key, name: key } as unknown as SongResult,
    tags: Object.keys(tags),
    tagAddedAt: tags,
    commentCount,
    timedCount: 0,
    updatedAt,
});
const tag = (key: string, order: number, name = key): SongNoteTag => ({ key, name, order, createdAt: order });
const t = ((key: string, options?: { count?: number }) => `${key}:${options?.count ?? ''}`) as unknown as TFunction;

describe('buildSongNoteTagGroups', () => {
    const rows = [
        row('s1', { rock: 30, night: 10 }, 100),
        row('s2', { rock: 20 }, 300),
        row('s3', {}, 200, 2),
        row('s4', {}, 400, 1),
        row('s5', { orphan: 5 }, 50),
    ];
    const tags = [tag('night', 1, 'Night'), tag('rock', 2, 'Rock')];

    it('groups by tag order, songs by when they were tagged, untagged last and newest first', () => {
        const groups = buildSongNoteTagGroups(rows, tags, null, 'Untagged');
        expect(groups.map(group => [group.key, group.name, group.rows.map(entry => entry.key)])).toEqual([
            ['night', 'Night', ['s1']],
            ['rock', 'Rock', ['s2', 's1']],
            ['orphan', 'orphan', ['s5']],
            [UNTAGGED_GROUP_KEY, 'Untagged', ['s4', 's3']],
        ]);
    });

    it('keeps only matches and drops empty groups', () => {
        const groups = buildSongNoteTagGroups(rows, tags, new Set(['s2', 's3']), 'Untagged');
        expect(groups.map(group => [group.key, group.rows.map(entry => entry.key)])).toEqual([
            ['rock', ['s2']],
            [UNTAGGED_GROUP_KEY, ['s3']],
        ]);
    });
});

describe('songNoteChipLine', () => {
    const map = new Map([['a', tag('a', 1, 'A')], ['b', tag('b', 2, 'B')], ['c', tag('c', 3, 'C')]]);
    it('shows the first two tags, how many more, and the comment count', () => {
        expect(songNoteChipLine(row('x', { a: 1, b: 2, c: 3 }, 1, 3), map, t)).toBe('#A #B +1 · songNotes.commentCount:3');
        expect(songNoteChipLine(row('x', { a: 1 }, 1), map, t)).toBe('#A');
        expect(songNoteChipLine(row('x', {}, 1, 2), map, t)).toBe('songNotes.commentCount:2');
        expect(songNoteChipLine(undefined, map, t)).toBe('');
    });
});

describe('buildSongNoteTagCommands', () => {
    it('makes one #tag command per used tag, with stable ids', () => {
        const commands = buildSongNoteTagCommands([tag('rock', 1, 'Rock'), tag('unused', 2), tag('夜车', 3)], new Map([['rock', 2], ['夜车', 1]]));
        expect(commands.map(command => command.title)).toEqual(['#Rock', '#夜车']);
        expect(commands[0].id).toBe(songNoteTagCommandId('rock'));
        expect(commands.every(command => command.textSource === 'runtime')).toBe(true);
        expect(new Set(commands.map(command => command.id)).size).toBe(2);
        expect(songNoteTagCommandId('rock')).not.toBe(songNoteTagCommandId('夜车'));
    });
});

describe('resolveHomeWallMode finiteOnly (the tags section passes it always)', () => {
    it('keeps the page finite while browsing and managing', () => {
        expect(resolveHomeWallMode({ section: 'folia-tags', visibilityMode: 'browse', batch: false, query: '', finiteOnly: true }).mode).toBe('finite');
        expect(resolveHomeWallMode({ section: 'folia-tags', visibilityMode: 'manage', batch: false, query: '', finiteOnly: true }).mode).toBe('finite');
        expect(resolveHomeWallMode({ section: 'folia', visibilityMode: 'browse', batch: false, query: '' }).mode).toBe('infinite');
    });
});

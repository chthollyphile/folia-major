import { describe, expect, it } from 'vitest';
import type { SongResult } from '@/types';
import type { RecentPlay } from '@/components/app/home/explore/recentPlays';
import { groupPlaysByDay, mergeRecentPlays } from '@/components/app/scratchpad/historyDays';

// test/unit/scratchpad/historyDays.test.ts
// 速记簿「播放历史」页：几个平台的记录合成一条（新的在前、同一首只留一次），按本地日历的天分段。

const play = (id: string, at: number): RecentPlay => ({ song: { id, name: id } as unknown as SongResult, at });
const keyOf = (entry: RecentPlay) => String(entry.song.id);
const local = (year: number, month: number, day: number, hour = 12, minute = 0) => new Date(year, month - 1, day, hour, minute).getTime();

describe('mergeRecentPlays', () => {
    it('puts the plays of several platforms in one list, the latest first, each song once', () => {
        const merged = mergeRecentPlays([
            [play('a', 30), play('b', 10)],
            [play('c', 20), play('a', 5)],
        ], keyOf);
        expect(merged.map(entry => [keyOf(entry), entry.at])).toEqual([['a', 30], ['c', 20], ['b', 10]]);
    });
});

describe('groupPlaysByDay', () => {
    it('splits at local midnight into today, yesterday and earlier days', () => {
        const now = local(2026, 11, 2, 9);
        const days = groupPlaysByDay([
            play('morning', local(2026, 11, 2, 8)),
            play('just after midnight', local(2026, 11, 2, 0, 30)),
            play('late evening', local(2026, 11, 1, 23, 50)),
            play('yesterday noon', local(2026, 11, 1, 12)),
            play('last week', local(2026, 10, 28, 20)),
        ], now);
        expect(days.map(day => [day.kind, day.plays.map(keyOf)])).toEqual([
            ['today', ['morning', 'just after midnight']],
            ['yesterday', ['late evening', 'yesterday noon']],
            ['earlier', ['last week']],
        ]);
        expect(days[2].start).toBe(local(2026, 10, 28, 0));
    });

    it('has no days for no plays', () => {
        expect(groupPlaysByDay([], Date.now())).toEqual([]);
    });
});

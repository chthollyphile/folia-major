import type { RecentPlay } from '../home/explore/recentPlays';

// src/components/app/scratchpad/historyDays.ts
// 速记簿第二页「播放历史」的纯函数：几份播放记录（各在线平台、本地、Navidrome）合成一条（新的在前），再按天分段。
// 记录本身是 Folia 自己的那一份（home/explore/recentPlays.ts，探索页「最近播放」也读它）：按来源与账户分开存，列最近七天。

/** 几个平台的播放记录合成一条，最后一次播放晚的在前；同一首（同一个播放键）只留一次。 */
export const mergeRecentPlays = (
    lists: readonly (readonly RecentPlay[])[],
    keyOf: (play: RecentPlay) => string,
): RecentPlay[] => {
    const seen = new Set<string>();
    return lists.flat()
        .sort((one, other) => other.at - one.at)
        .filter(play => {
            const key = keyOf(play);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
};

export type HistoryDay = {
    /** 那一天本地零点的时间戳，也当分段的 key。 */
    start: number;
    /** 今天、昨天，或更早的某一天（标题按日期写）。 */
    kind: 'today' | 'yesterday' | 'earlier';
    plays: RecentPlay[];
};

const startOfDay = (at: number) => {
    const date = new Date(at);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
};

/** 按本地日历的天分段（零点为界：列表上写着几点几分，跨零点的那一晚照日期分开才对得上）。plays 须新的在前。 */
export const groupPlaysByDay = (plays: readonly RecentPlay[], now: number): HistoryDay[] => {
    const today = startOfDay(now);
    const yesterday = startOfDay(today - 1);
    const days: HistoryDay[] = [];
    for (const play of plays) {
        const start = startOfDay(play.at);
        let day = days[days.length - 1];
        if (!day || day.start !== start) {
            day = { start, kind: start >= today ? 'today' : start === yesterday ? 'yesterday' : 'earlier', plays: [] };
            days.push(day);
        }
        day.plays.push(play);
    }
    return days;
};

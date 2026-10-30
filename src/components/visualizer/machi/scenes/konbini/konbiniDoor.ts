import type { Line } from '../../../../../types';
import { isInterludeLine } from '../../../../../utils/lyrics/parserCore';
import { getLineRenderEndTime } from '../../../../../utils/lyrics/renderHints';
import { buildStructureLines, draftParagraphs, resolveParagraphGapThreshold } from '../../../paragraphStructure';
import type { KonbiniVariation } from './konbiniSeed';

// src/components/visualizer/machi/scenes/konbini/konbiniDoor.ts
// 便利店的自动门什么时候开（纯函数）：段落开头像有人进店，长间奏里按这首歌的节奏偶尔开。跟歌曲时间走，拖进度也对得上。

/** 自动门开合的几个时段（秒）。 */
export const KONBINI_DOOR_TIMING = { open: 0.75, hold: 2.6, close: 1.0, lead: 0.7 } as const;
const DOOR_CYCLE = KONBINI_DOOR_TIMING.open + KONBINI_DOOR_TIMING.hold + KONBINI_DOOR_TIMING.close;

/**
 * 开门时刻（歌曲时间，秒）：每个段落开头（第一段除外）提前一点开门，像有人进店；段落之间空了很久时，
 * 空隙里按这首歌的节奏再开几次。
 */
export const buildKonbiniDoorEvents = (lines: readonly Line[], variation: Pick<KonbiniVariation, 'doorInterval' | 'doorPhase'>): number[] => {
    const sung = lines.filter(line => !isInterludeLine(line) && line.fullText.trim());
    if (sung.length === 0) return [];
    const structure = buildStructureLines(sung);
    const drafts = draftParagraphs(structure, resolveParagraphGapThreshold(sung));
    const events: number[] = [];
    drafts.forEach((draft, index) => {
        if (index === 0) return;
        const start = draft.lines[0]!.line.startTime;
        events.push(Math.max(0, start - KONBINI_DOOR_TIMING.lead));
    });
    // 长空隙（前奏、间奏、尾奏）里按间隔补几次。
    const gaps: [number, number][] = [[0, sung[0]!.startTime]];
    for (let i = 1; i < sung.length; i += 1) gaps.push([getLineRenderEndTime(sung[i - 1]!), sung[i]!.startTime]);
    gaps.forEach(([from, to]) => {
        if (to - from < variation.doorInterval * 0.6) return;
        for (let t = from + variation.doorInterval * (0.35 + variation.doorPhase * 0.4); t < to - DOOR_CYCLE; t += variation.doorInterval) {
            events.push(t);
        }
    });
    return events.sort((a, b) => a - b).filter((time, index, all) => index === 0 || time - all[index - 1]! >= DOOR_CYCLE);
};

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * 门开了多少（0 关、1 全开）。有歌词的歌按开门时刻表；纯音乐按 seed 的节奏周期性开。speed 是主题动效强度。
 */
export const resolveKonbiniDoorOpenness = (
    events: readonly number[],
    time: number,
    variation: Pick<KonbiniVariation, 'doorInterval' | 'doorPhase'>,
    instrumental: boolean,
): number => {
    let since = Infinity;
    if (instrumental || events.length === 0) {
        const phase = time / variation.doorInterval + variation.doorPhase;
        since = (phase - Math.floor(phase)) * variation.doorInterval;
    } else {
        for (let i = events.length - 1; i >= 0; i -= 1) {
            if (events[i]! <= time) {
                since = time - events[i]!;
                break;
            }
        }
    }
    const { open, hold, close } = KONBINI_DOOR_TIMING;
    if (since < 0 || since >= open + hold + close) return 0;
    if (since < open) return easeOutCubic(since / open);
    if (since < open + hold) return 1;
    return 1 - easeInOutCubic((since - open - hold) / close);
};

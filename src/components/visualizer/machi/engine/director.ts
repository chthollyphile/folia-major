import type { Line } from '../../../../types';
import { isInterludeLine } from '../../../../utils/lyrics/parserCore';
import { getLineRenderEndTime } from '../../../../utils/lyrics/renderHints';
import { hashVisualizerSeed, visualizerHash01 } from '../../visualizerSeedHash';

// src/components/visualizer/machi/engine/director.ts
// 町景的编排（纯函数，三个场景共用）：歌词屏此刻该亮哪一行还是曲名卡、跑马灯写什么、副歌权重、副歌开头的闪电、
// 招牌的闪烁日程、音频包络。牌面、副歌、闪电跟歌曲时间走（拖进度也对得上），闪烁跟氛围时钟走。

export type MachiBoardTarget = { kind: 'line'; index: number } | { kind: 'card' };

/** 一行唱完后，下一行还没来时牌面再留多久才换成曲名卡。 */
const BOARD_HOLD_SECONDS = 2.6;
/** 牌面比歌词略早一点亮出来，翻牌动画落在唱起的那一刻。 */
const BOARD_LEAD_SECONDS = 0.12;

/** 时刻 time 的牌面：在唱或刚唱完的那一行；间奏、开唱前、长空隙里是曲名卡。 */
export const resolveMachiBoardTarget = (lines: readonly Line[], time: number): MachiBoardTarget => {
    let index = -1;
    for (let i = 0; i < lines.length; i += 1) {
        if (lines[i]!.startTime <= time + BOARD_LEAD_SECONDS) index = i;
        else break;
    }
    if (index < 0) return { kind: 'card' };
    const line = lines[index]!;
    if (isInterludeLine(line) || !line.fullText.trim()) return { kind: 'card' };
    const next = lines[index + 1];
    const hold = getLineRenderEndTime(line) + BOARD_HOLD_SECONDS;
    if (time > hold && (!next || next.startTime - BOARD_LEAD_SECONDS > time)) return { kind: 'card' };
    return { kind: 'line', index };
};

export const sameBoardTarget = (a: MachiBoardTarget | null, b: MachiBoardTarget) => (
    !!a && a.kind === b.kind && (a.kind === 'card' || (b.kind === 'line' && a.index === b.index))
);

export const isChorusLine = (line: Line | undefined) => !!line && (line.isChorus === true || /chorus|副歌/i.test(line.songPart ?? ''));

/** 副歌权重：正在唱副歌行（或刚唱完、下一行还是副歌）时为 1。运行时再做平滑。 */
export const resolveMachiChorus = (lines: readonly Line[], target: MachiBoardTarget): number => {
    if (target.kind !== 'line') return 0;
    return isChorusLine(lines[target.index]) ? 1 : 0;
};

/** 招牌闪烁：每 6.5 秒一个窗口，按哈希决定这个窗口里有没有一阵快速的明暗（三下），返回亮度倍数 0.5..1。 */
export const resolveMachiFlicker = (time: number, seed: string | number, rate = 1): number => {
    const window = 6.5 / Math.max(0.3, rate);
    const index = Math.floor(time / window);
    const key = hashVisualizerSeed(`flicker:${seed}`);
    if (visualizerHash01(key, index, 0x51) > 0.42) return 1;
    const offset = visualizerHash01(key, index, 0x7a) * (window - 0.6);
    const local = time - index * window - offset;
    if (local < 0 || local > 0.46) return 1;
    // 三下：越来越短的暗。
    const dips = [[0, 0.07, 0.5], [0.15, 0.2, 0.68], [0.32, 0.36, 0.8]] as const;
    for (const [from, to, depth] of dips) {
        if (local >= from && local <= to) return depth;
    }
    return 1;
};

/** 音频包络：一见到大于 1 的值就按 0..255 归一化（主播放器），否则当 0..1（预览、OBS）；起音快、释放慢。 */
export class MachiAudioFollower {
    value = 0;
    private byteScale = false;

    step(raw: number, deltaSeconds: number, attack = 0.06, release = 0.25) {
        if (raw > 1.0001) this.byteScale = true;
        const target = Math.max(0, Math.min(1, this.byteScale ? raw / 255 : raw));
        const tau = target > this.value ? attack : release;
        const k = deltaSeconds <= 0 ? 0 : 1 - Math.exp(-deltaSeconds / tau);
        this.value += (target - this.value) * k;
        return this.value;
    }
}

// —— 闪电 ————————————————————————————————————————————————————————————

/** 每段副歌的开头（相邻副歌行算一段）。 */
export const buildMachiLightningTimes = (lines: readonly Line[]) => lines
    .filter((line, index) => isChorusLine(line) && !isChorusLine(lines[index - 1]))
    .map(line => line.startTime);

/** 闪电亮度 0..1：两下闪，第二下略弱，一秒内收尽。 */
export const resolveMachiLightning = (times: readonly number[], time: number) => {
    let since = Infinity;
    for (let index = times.length - 1; index >= 0; index -= 1) {
        if (times[index]! <= time) {
            since = time - times[index]!;
            break;
        }
    }
    if (since > 1.2) return 0;
    const flash = (at: number, width: number, height: number) => height * Math.exp(-((since - at) ** 2) / (width * width));
    return Math.min(1, flash(0.04, 0.05, 1) + flash(0.24, 0.06, 0.7) + 0.25 * Math.exp(-since * 3.5));
};

/** 跑马灯（LED 字条、出租车顶灯）写什么：下一句；没有下一句时用这一句的译文；曲名卡时是曲名与歌手。 */
export const resolveMachiTickerText = (target: MachiBoardTarget, lines: readonly Line[], song: { title: string; artist: string }, fallbackTitle: string) => {
    const title = song.title || fallbackTitle;
    if (target.kind === 'card') return `♪ ${title}${song.artist ? ` — ${song.artist}` : ''}   ◆   OPEN 24H   ◆`;
    const next = lines.slice(target.index + 1).find(line => line.fullText.trim());
    const current = lines[target.index];
    const parts = [
        next ? `NEXT ▸ ${next.fullText}` : '',
        current?.translation ? `◆ ${current.translation}` : '',
    ].filter(Boolean);
    return parts.length ? `${parts.join('   ')}   ` : `♪ ${title}   ◆   `;
};

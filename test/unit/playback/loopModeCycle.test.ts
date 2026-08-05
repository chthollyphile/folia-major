import { describe, expect, it } from 'vitest';
import { getNextLoopMode } from '@/utils/appStageHelpers';
import type { StageLoopMode } from '@/types';

// test/unit/playback/loopModeCycle.test.ts
// 锁定播放模式切换链。store 与 Stage 遥控共用这一份，链条改动必须是有意为之。

describe('getNextLoopMode', () => {
    it('按 顺序 → 列表循环 → 单曲循环 → 随机 → 顺序 循环', () => {
        expect(getNextLoopMode('off')).toBe('all');
        expect(getNextLoopMode('all')).toBe('one');
        expect(getNextLoopMode('one')).toBe('shuffle');
        expect(getNextLoopMode('shuffle')).toBe('off');
    });

    it('连续切换四次回到起点，不会漏掉或重复模式', () => {
        const visited: StageLoopMode[] = [];
        let mode: StageLoopMode = 'off';

        for (let step = 0; step < 4; step += 1) {
            mode = getNextLoopMode(mode);
            visited.push(mode);
        }

        expect(visited).toEqual(['all', 'one', 'shuffle', 'off']);
        expect(new Set(visited).size).toBe(4);
    });
});

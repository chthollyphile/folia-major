import { describe, expect, it } from 'vitest';
import {
    PANEL_OPEN_CLIP,
    capsuleBodyHeight,
    capsuleClipPath,
    listArrowStep,
    type CapsuleFrame,
} from '../../../src/components/command-palette/capsuleFrame';

// 面板从进度条胶囊长出来时的几何：clip-path 起点对准胶囊、和终点逐项对得上，body 高度在胶囊上方放得下，
// 倒排列表的方向键。

const frame = (overrides: Partial<CapsuleFrame> = {}): CapsuleFrame => ({
    left: 352,
    width: 320,
    height: 72,
    bottomGap: 32,
    viewportWidth: 1024,
    ...overrides,
});

/** 把 clip-path 里的数字抽出来，用来核对两端能逐项插值。 */
const numbers = (clip: string) => clip.match(/-?\d+(\.\d+)?/g) ?? [];
const template = (clip: string) => clip.replace(/-?\d+(\.\d+)?/g, '#');

describe('capsuleClipPath', () => {
    it('居中的胶囊：只露出底部胶囊那一段，左右等距，圆角是半高', () => {
        // 面板宽 672，左起 176；胶囊 352..672 → 左 176、右 176。
        expect(capsuleClipPath(frame())).toBe('inset(calc(100% - 72px) 176px 0px 176px round 36px)');
    });

    it('胶囊偏离中线时两侧不等，且不会裁出面板以外', () => {
        expect(capsuleClipPath(frame({ left: 200 }))).toBe('inset(calc(100% - 72px) 328px 0px 24px round 36px)');
        // 比面板还宽、还偏的胶囊被夹回面板范围内。
        expect(capsuleClipPath(frame({ left: 0, width: 900 }))).toBe('inset(calc(100% - 72px) 0px 0px 0px round 36px)');
    });

    it('窄屏上面板宽度按两侧各 16px 的外边距算', () => {
        // 视口 375：面板 343，左起 16；胶囊 32..343 宽 311。
        expect(capsuleClipPath(frame({ viewportWidth: 375, left: 32, width: 311, height: 48 })))
            .toBe('inset(calc(100% - 48px) 16px 0px 16px round 24px)');
    });

    it('起点和展开后的终点数字个数、写法一致，framer-motion 才能逐项插值', () => {
        const start = capsuleClipPath(frame({ left: 200.25, width: 301.5 }));
        expect(template(start)).toBe(template(PANEL_OPEN_CLIP));
        expect(numbers(start)).toHaveLength(numbers(PANEL_OPEN_CLIP).length);
    });
});

describe('capsuleBodyHeight', () => {
    it('在原来的 min(496px, 50vh) 上再加「胶囊上方放得下」一条，仍交给 CSS 解', () => {
        expect(capsuleBodyHeight(frame())).toBe('min(496px, 50vh, calc(100vh - 192px))');
        expect(capsuleBodyHeight(frame({ bottomGap: 300.4 }))).toBe('min(496px, 50vh, calc(100vh - 460px))');
    });
});

describe('listArrowStep', () => {
    it('平常向下是下一名', () => {
        expect(listArrowStep('ArrowDown', false)).toBe(1);
        expect(listArrowStep('ArrowUp', false)).toBe(-1);
    });

    it('列表倒排时向上才是下一名', () => {
        expect(listArrowStep('ArrowUp', true)).toBe(1);
        expect(listArrowStep('ArrowDown', true)).toBe(-1);
    });

    it('别的键不动', () => {
        expect(listArrowStep('Enter', true)).toBe(0);
    });
});

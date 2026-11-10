import { describe, expect, it, vi } from 'vitest';
import type { Line } from '@/types';
import { LUMIERE_PROFILES } from '@/components/visualizer/lumiere/catalog';
import { createLyricWindow, type LyricWindowFrame, type WindowTypography } from '@/components/visualizer/lumiere/text/lyricWindow';
import { installFakeTextMeasure } from './lumiereFixtures';
import { FakeContainer, FakeGraphics, fakePixi, fakeSprites } from './lumiereWindowFakes';

// test/unit/visualizer/lumiere/lumiereTrails.test.ts
// 隐藏轨迹覆盖强制飞行、纵横交错与横竖切换：立即清空线层，不改变字的位置，重新打开可恢复径迹。
vi.mock('@/components/visualizer/lumiere/text/glyphLine', async importOriginal => (
    (await import('./lumiereWindowFakes')).fakeGlyphLineModule(await importOriginal())
));
installFakeTextMeasure();

const LINES: Line[] = ['光落在晨雾里', '我们走回去', '星河与风'].map((fullText, index) => {
    const startTime = 2 + index * 3;
    return { fullText, startTime, endTime: startTime + 2, words: [{ text: fullText, startTime, endTime: startTime + 2 }] };
});

const FRAME: LyricWindowFrame = {
    time: 4.5,
    beams: [],
    litColor: [1, 1, 1],
    unlitColor: [0.5, 0.5, 0.5],
    unlitAlpha: 0.22,
    intensity: 1,
};

describe('歌词轨迹线可实时隐藏', () => {
    const cases: Array<[string, WindowTypography, boolean, ((index: number) => WindowTypography) | undefined]> = [
        ['每次换位都飞', 'horizontal', true, undefined],
        ['纵横交错，未强制飞行', 'crossed', false, undefined],
        ['横竖切换，未强制飞行', 'horizontal', false, index => index % 2 ? 'vertical' : 'horizontal'],
    ];
    it.each(cases)('%s', (_label, typography, alwaysFly, typographyOf) => {
        const profile = LUMIERE_PROFILES[0]!;
        const window = createLyricWindow(fakePixi, {
            width: 1600,
            height: 900,
            lines: LINES,
            font: 'sans-serif',
            weight: 500,
            resolution: 1,
            region: { cx: profile.region.cx * 1600 / 900, cy: profile.region.cy, w: profile.region.w * 1600 / 900, h: profile.region.h },
            heroPx: profile.heroSize * 900,
            neighbors: 2,
            typography,
            typographyOf,
            decay: profile.decay,
            alwaysFly,
            seed: 'hidden-trails',
            sprites: fakeSprites,
        });
        // 径迹层在自己的渲染组里（window.view 的第二个子节点）。
        const tracks = (window.view.children[1] as unknown as FakeContainer).children[0] as FakeGraphics;
        window.update(FRAME);
        const anchor = window.glyphAnchor(1, 0, FRAME.time);
        expect(tracks.visible).toBe(true);
        expect(tracks.strokes.some(alpha => alpha > 0)).toBe(true);
        window.update({ ...FRAME, hideTrails: true });
        expect(tracks.visible).toBe(false);
        expect(tracks.strokes).toEqual([]);
        expect(window.glyphAnchor(1, 0, FRAME.time)).toEqual(anchor);
        window.update({ ...FRAME, hideTrails: false });
        expect(tracks.visible).toBe(true);
        expect(tracks.strokes.some(alpha => alpha > 0)).toBe(true);
        expect(window.glyphAnchor(1, 0, FRAME.time)).toEqual(anchor);
        window.destroy();
    });
});

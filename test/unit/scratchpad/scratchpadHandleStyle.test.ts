// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
    SCRATCHPAD_HANDLE_STYLES,
    isScratchpadHandleStyle,
    useScratchpadSettingsStore,
} from '@/stores/useScratchpadSettingsStore';
import { buildVisualSettingsConfig } from '@/services/obs/visualSettingsConfig';
import { decompressConfig } from '@/utils/appearanceCodec';
import { scratchpadShapeClipPath, scratchpadShapePath, scratchpadShapePolygons } from '@/components/app/scratchpad/scratchpadLook';

// test/unit/scratchpad/scratchpadHandleStyle.test.ts
// 速记簿悬浮标签的样式设置：只认四种、存进本机、随外观配置导出导入（短码 sphs）；以及三页几何体的形状。

afterEach(() => {
    useScratchpadSettingsStore.getState().setHandleStyle('strip');
    localStorage.removeItem('scratchpad_handle_style');
});

describe('scratchpad side tab style', () => {
    it('knows the four styles and nothing else', () => {
        expect(SCRATCHPAD_HANDLE_STYLES).toEqual(['strip', 'line', 'dot', 'shapes']);
        expect(SCRATCHPAD_HANDLE_STYLES.every(isScratchpadHandleStyle)).toBe(true);
        expect(isScratchpadHandleStyle('glass')).toBe(false);
        expect(isScratchpadHandleStyle(undefined)).toBe(false);
    });

    it('saves a picked style and falls back to the paper strip for an unknown one', () => {
        const store = useScratchpadSettingsStore.getState();
        store.setHandleStyle('dot');
        expect(useScratchpadSettingsStore.getState().handleStyle).toBe('dot');
        expect(localStorage.getItem('scratchpad_handle_style')).toBe('dot');
        store.setHandleStyle('glass' as never);
        expect(useScratchpadSettingsStore.getState().handleStyle).toBe('strip');
        expect(localStorage.getItem('scratchpad_handle_style')).toBe('strip');
    });

    it('travels with the exported look, in both the short and the full form', () => {
        useScratchpadSettingsStore.getState().setHandleStyle('shapes');
        expect(buildVisualSettingsConfig()).toMatchObject({ scratchpadHandleStyle: 'shapes' });
        // A hand-written minified config carrying only this is recognised as the minified shape.
        expect(decompressConfig(JSON.stringify({ sphs: 'line' }))).toMatchObject({ scratchpadHandleStyle: 'line' });
        expect(decompressConfig(JSON.stringify({ scratchpadHandleStyle: 'dot' }))).toMatchObject({ scratchpadHandleStyle: 'dot' });
    });
});

describe('scratchpad shapes', () => {
    it('draws the queue chevron as two separate points and the others as one polygon', () => {
        expect(scratchpadShapePolygons('circle', 20)).toHaveLength(1);
        expect(scratchpadShapePolygons('tri', 20)).toEqual([[[10, 0], [20, 20], [0, 20]]]);
        const [first, second] = scratchpadShapePolygons('chev', 20);
        // The first point's tip stays left of the second point's notch: the two never touch.
        const firstTip = Math.max(...first.map(([x]) => x));
        const secondNotch = second[5][0];
        expect(firstTip).toBeLessThan(secondNotch);
    });

    it('keeps every point inside the box', () => {
        for (const kind of ['circle', 'tri', 'chev'] as const) {
            for (const polygon of scratchpadShapePolygons(kind, 40)) {
                for (const [x, y] of polygon) {
                    expect(x).toBeGreaterThanOrEqual(-1e-9);
                    expect(x).toBeLessThanOrEqual(40 + 1e-9);
                    expect(y).toBeGreaterThanOrEqual(-1e-9);
                    expect(y).toBeLessThanOrEqual(40 + 1e-9);
                }
            }
        }
    });

    it('writes one closed subpath per polygon, and clips circles without a path', () => {
        expect(scratchpadShapePath('chev', 20).match(/Z/g)).toHaveLength(2);
        expect(scratchpadShapePath('tri', 20)).toBe('M10 0 L20 20 L0 20 Z');
        expect(scratchpadShapeClipPath('circle', 20)).toBe('circle(50%)');
        expect(scratchpadShapeClipPath('tri', 20)).toBe("path('M10 0 L20 20 L0 20 Z')");
    });
});

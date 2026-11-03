import { describe, expect, it } from 'vitest';
import { resolveLibraryLayerPresentation } from '@/library/core/suite/libraryStage';

// test/unit/library/core/libraryStage.test.ts
// 集合宿主的分层呈现（B1）：当前层由带 stage 的 suite 渲染时不垫背景板、不藏首页；其余情况与没有 stage 时一样。

describe('library layer presentation (B1)', () => {
    it('shows the home and no backdrop while no layer is open, stage or not', () => {
        for (const stageSuiteId of [null, 'wall']) {
            expect(resolveLibraryLayerPresentation({ hasOpenLayer: false, stageSuiteId, layerSuiteId: 'grid' }))
                .toEqual({ showBackdrop: false, hideHome: false });
            expect(resolveLibraryLayerPresentation({ hasOpenLayer: false, stageSuiteId, layerSuiteId: 'wall' }))
                .toEqual({ showBackdrop: false, hideHome: false });
        }
    });

    it('keeps the backdrop and hides the home for a layer without a stage (grid / TUI today)', () => {
        expect(resolveLibraryLayerPresentation({ hasOpenLayer: true, stageSuiteId: null, layerSuiteId: 'grid' }))
            .toEqual({ showBackdrop: true, hideHome: true });
        expect(resolveLibraryLayerPresentation({ hasOpenLayer: true, stageSuiteId: null, layerSuiteId: 'tui' }))
            .toEqual({ showBackdrop: true, hideHome: true });
    });

    it('leaves the picture to the stage when the layer belongs to the suite that owns it', () => {
        expect(resolveLibraryLayerPresentation({ hasOpenLayer: true, stageSuiteId: 'wall', layerSuiteId: 'wall' }))
            .toEqual({ showBackdrop: false, hideHome: false });
    });

    it('keeps the backdrop when the layer falls back to the grid under a stage suite', () => {
        // 选中的 suite 有 stage，但没实现这个 surface（例如歌手页）：渲染当前层的是 grid，背景板照常。
        expect(resolveLibraryLayerPresentation({ hasOpenLayer: true, stageSuiteId: 'wall', layerSuiteId: 'grid' }))
            .toEqual({ showBackdrop: true, hideHome: true });
    });
});

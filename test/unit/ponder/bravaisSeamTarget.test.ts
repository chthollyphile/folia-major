import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { findPonderTarget } from '@/components/ponder/ponderRegistry';
import PonderSurfaceContents from '@/components/ponder/PonderSurfaceContents';
import {
    BRAVAIS_HOME_DOCK,
    BRAVAIS_HOME_DOCK_STAGE,
    BRAVAIS_HOME_SEAM_GEOMETRY as H,
    BRAVAIS_SEAM_WIDTHS,
    BRAVAIS_WALL_LEFT,
    BRAVAIS_WALL_RIGHT,
    bravaisSeamRect,
    bravaisWallTileRect,
    type BravaisSeamWidthKey,
} from '@/components/ponder/surfaces/ponderBravaisSeamGeometry';
import type { PonderRelativeRect, PonderSurfaceKind } from '@/types/ponder';

// test/unit/ponder/bravaisSeamTarget.test.ts
// bravais 信息条那一篇（bravais-seam）的形状：章节顺序、指针命中的属性真的挂在缝上、
// 合成界面画出了字幕在讲的那些东西，以及几何上「墙不压进缝、窄缝里各段不互相叠」。

const SRC = path.resolve(__dirname, '../../../src');

const renderSurface = (kind: PonderSurfaceKind) => renderToStaticMarkup(
    React.createElement(PonderSurfaceContents, {
        kind,
        accent: '#ff3366',
        line: 'rgba(255,255,255,0.1)',
        outline: 'rgba(255,255,255,0.2)',
    }),
);

/** 竖直方向的 [top, bottom]（top + height 或 top + bottom 写的矩形）。 */
const span = (rect: PonderRelativeRect): [number, number] => {
    const top = rect.top ?? 0;
    return [top, rect.height !== undefined ? top + rect.height : 1 - (rect.bottom ?? 0)];
};

describe('bravais-seam target', () => {
    const target = findPonderTarget('bravais-seam');

    it('注册了，归在「浏览」，并指向墙那一篇', () => {
        expect(target).not.toBeNull();
        expect(target!.category).toBe('browsing');
        expect(target!.relatedTargetIds).toContain('bravais-wall');
    });

    it('六章：三档、集合页、首页导航、账户与工具格、过滤与搜索、墙面工具', () => {
        expect(target!.scenes.map(scene => scene.id)).toEqual([
            'bravais-seam-levels',
            'bravais-seam-collection',
            'bravais-seam-home-navigation',
            'bravais-seam-home-dock',
            'bravais-seam-filter',
            'bravais-seam-tools',
        ]);
    });

    it('指针停在缝上（含折叠后的侧边标签）就命中：选择器用的是缝自己挂的属性', () => {
        expect(target!.hoverSelector).toBe('[data-bravais-seam], [data-bravais-seam-tab]');
        const seam = readFileSync(path.join(SRC, 'library/suites/bravais/BravaisSeam.tsx'), 'utf8');
        expect(seam).toMatch(/data-bravais-seam=\{/);
        expect(seam).toMatch(/data-bravais-seam-tab=\{/);
    });

    it('首页窄缝画出五个竖排页签、账户入口与工具格四格', () => {
        const markup = renderSurface('bravais-seam-home');
        expect(markup).toContain('data-ponder-surface-kind="bravais-seam-home"');
        expect(markup.match(/data-ponder-bravais-tab="\d"/g)?.length).toBeGreaterThanOrEqual(5);
        for (const marker of ['tool-search', 'tool-settings', 'tool-queue', 'tool-more', 'account', 'shortcuts']) {
            expect(markup, marker).toContain(`data-ponder-bravais-${marker}`);
        }
        // 结果层也预先画好：二级切换、平台列表、「⋯」菜单、舞台那一行、过滤位、搜索态、工具面板。
        for (const marker of ['sections', 'menu', 'stage-row', 'filter', 'search-seam', 'tools-panel']) {
            expect(markup, marker).toContain(`data-ponder-bravais-${marker}`);
        }
    });

    it('集合页画出完整信息条，以及书脊、折叠标签、列表面板几档', () => {
        const markup = renderSurface('bravais-seam-strip');
        expect(markup).toContain('data-ponder-surface-kind="bravais-seam-strip"');
        for (const marker of ['strip', 'crumbs', 'title', 'about', 'actions', 'list', 'more', 'strip-menu', 'spine', 'edge-tab', 'panel']) {
            expect(markup, marker).toContain(`data-ponder-bravais-${marker}`);
        }
    });

    it.each(Object.keys(BRAVAIS_SEAM_WIDTHS) as BravaisSeamWidthKey[])('%s 档：墙的两半不压进缝里', key => {
        const seam = bravaisSeamRect(key);
        const left = seam.left!;
        const right = left + seam.width!;
        BRAVAIS_WALL_RIGHT.forEach(tile => {
            expect(bravaisWallTileRect(tile, 'right', BRAVAIS_SEAM_WIDTHS[key]).left!).toBeGreaterThan(right);
        });
        BRAVAIS_WALL_LEFT.forEach(tile => {
            const rect = bravaisWallTileRect(tile, 'left', BRAVAIS_SEAM_WIDTHS[key]);
            expect(rect.left! + rect.width!).toBeLessThan(left);
        });
    });

    it('首页窄缝从上到下各段不互相叠：页签 → 二级切换 → 直达 → 账户 → 工具格', () => {
        const order = [H.tabs, H.sections, H.shortcuts, BRAVAIS_HOME_DOCK.account, BRAVAIS_HOME_DOCK.tools];
        for (let index = 1; index < order.length; index += 1) {
            const [, previousBottom] = span(order[index - 1]);
            const [top] = span(order[index]);
            expect(top, `第 ${index} 段`).toBeGreaterThanOrEqual(previousBottom);
        }
        // 舞台那一行把账户入口往上顶，过滤位插在直达与账户之间，同样不叠。
        expect(span(BRAVAIS_HOME_DOCK_STAGE.account)[1]).toBeLessThanOrEqual(span(BRAVAIS_HOME_DOCK_STAGE.stageRow)[0]);
        expect(span(H.shortcutsFiltering)[1]).toBeLessThanOrEqual(span(H.filter)[0]);
        expect(span(H.filter)[1]).toBeLessThanOrEqual(span(BRAVAIS_HOME_DOCK.account)[0]);
        expect(span(H.shortcutsFiltering)[1]).toBeLessThanOrEqual(span(BRAVAIS_HOME_DOCK_STAGE.account)[0]);
    });
});

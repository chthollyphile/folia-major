import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PonderSurfaceContents from '@/components/ponder/PonderSurfaceContents';
import { LOCAL_GRID_MAP_GEOMETRY } from '@/components/ponder/surfaces/library/localLibrary.geometry';
import type { PonderSurfaceKind } from '@/types/ponder';

// test/unit/ponder/ponderSurfaceContents.test.ts
// Each tutorial surface keeps the recognizable structure of the real UI it stands in for.

const renderSurface = (kind: PonderSurfaceKind) => renderToStaticMarkup(
    React.createElement(PonderSurfaceContents, {
        kind,
        accent: '#ff3366',
        line: 'rgba(255,255,255,0.1)',
        outline: 'rgba(255,255,255,0.2)',
    }),
);

describe('PonderSurfaceContents', () => {
    it('plain 只有外框，里面什么都不画', () => {
        const markup = renderSurface('plain');
        expect(markup).toBe('<div class="absolute inset-0" data-ponder-surface-kind="plain"></div>');
    });

    it('palette 有搜索栏', () => {
        const markup = renderSurface('palette');
        expect(markup).toContain('data-ponder-surface-kind="palette"');
        expect(markup).toContain('data-ponder-palette-header');
    });

    it('picker 有两个接近真实设置项的下拉框', () => {
        const markup = renderSurface('picker');
        expect(markup.match(/data-ponder-picker-field/g)).toHaveLength(2);
        expect(markup).not.toContain('data-ponder-palette-header');
    });

    it('queue 有命令面板栏和曲目行', () => {
        const markup = renderSurface('queue');
        expect(markup).toContain('data-ponder-palette-header');
        expect(markup.match(/data-ponder-queue-row/g)).toHaveLength(4);
    });

    it('volume 有命令面板栏和音量滑杆', () => {
        const markup = renderSurface('volume');
        expect(markup).toContain('data-ponder-palette-header');
        expect(markup).toContain('data-ponder-volume-track');
    });

    it.each([
        'grid-page',
        'grid-view-page',
        'player-page',
        'lattice-page',
        'settings-page',
    ] as const)('%s 有自己的页面轮廓', kind => {
        const markup = renderSurface(kind);
        expect(markup).toContain(`data-ponder-surface-kind="${kind}"`);
        expect(markup).not.toContain('data-ponder-palette-header');
    });

    it('入门教程画的是思索本身：一页界面、提示胶囊、触屏那颗灯泡', () => {
        const markup = renderSurface('ponder-onboarding');
        expect(markup).toContain('data-ponder-onboarding-structure');
        // 被指的那个组件、浮出来的胶囊、右下角的灯泡，三样缺一样这张图就讲不成。
        expect(markup).toContain('data-ponder-onboarding-card-c');
        expect(markup).toContain('data-ponder-onboarding-capsule');
        expect(markup).toContain('data-ponder-onboarding-touch-bulb');
        ['hint-shown', 'hint-holding', 'ponder-open'].forEach(state => {
            expect(markup).toContain(`data-ponder-surface-state="${state}"`);
        });
    });

    it('Grid3D surface 按真实页头、3D 轨道和操作结果分层', () => {
        const markup = renderSurface('grid-page');
        expect(markup).toContain('data-ponder-grid-page-structure');
        expect(markup).toContain('data-ponder-grid-tabs');
        expect(markup).toContain('data-ponder-grid-search');
        expect(markup).toContain('data-ponder-grid-shelf');
        expect(markup.match(/data-ponder-grid-card/g)).toHaveLength(5);
        ['tab-switched', 'collection-open', 'map-open', 'search-open', 'command-open'].forEach(state => {
            expect(markup).toContain(`data-ponder-surface-state="${state}"`);
        });
    });

    it('本地曲库新增的三个 surface 各自保留可识别结构', () => {
        const controls = renderSurface('local-grid-controls');
        expect(controls).toContain('data-ponder-local-grid-controls-structure');
        expect(controls.match(/data-ponder-local-grid-tab=/g)).toHaveLength(4);

        const onlineActions = renderSurface('online-collection-actions');
        expect(onlineActions).toContain('data-ponder-online-collection-actions-structure');
        expect(onlineActions).toContain('data-ponder-online-provider-action');

        const map = renderSurface('local-grid-map');
        expect(map).toContain('data-ponder-local-grid-map-structure');
        expect(map).toContain('data-ponder-local-grid-map-tree');
        expect(map).toContain('data-ponder-surface-state="tree-open"');
        expect(map).toContain('bg-zinc-950/95');
        expect(LOCAL_GRID_MAP_GEOMETRY.panel.width).toBeLessThanOrEqual(0.24);
        expect(LOCAL_GRID_MAP_GEOMETRY.actions.height).toBeLessThanOrEqual(0.06);
    });

    it('Lattice surface 是不规则海报墙，并包含展开、工具和灯光结果', () => {
        const markup = renderSurface('lattice-page');
        expect(markup).toContain('data-ponder-lattice-page-structure');
        expect(markup).toContain('data-ponder-lattice-wall');
        expect(markup.match(/data-ponder-lattice-poster/g)?.length ?? 0).toBeGreaterThanOrEqual(12);
        ['wall-panned', 'poster-focused', 'poster-expanded', 'tools-open', 'lights-off', 'command-open'].forEach(state => {
            expect(markup).toContain(`data-ponder-surface-state="${state}"`);
        });
    });

    it('bravais 墙是缝在正中的磁贴墙，每一次操作的结果层都预渲染在场', () => {
        const markup = renderSurface('bravais-wall');
        expect(markup).toContain('data-ponder-bravais-wall-structure');
        expect(markup).toContain('data-ponder-bravais-seam="home"');
        expect(markup).toContain('data-ponder-bravais-seam="collection"');
        // 四种样子都在墙上：歌曲海报、集合（叠页边 + 「种类 · N」）、歌手人像、强调色底的特殊标签。
        ['track', 'album', 'playlist', 'artist', 'folder', 'feed'].forEach(kind => {
            expect(markup).toContain(`data-kind="${kind}"`);
        });
        expect(markup).toContain('data-ponder-bravais-badge="special"');
        expect(markup).toContain('data-ponder-bravais-portrait="duotone"');
        expect(markup).toContain('data-ponder-bravais-portrait="color"');
        ['open', 'queued', 'playing'].forEach(state => {
            expect(markup).toContain(`data-ponder-bravais-focus-card="${state}"`);
        });
        expect(markup).toContain('data-ponder-bravais-focus-enter');
        ['solid', 'partial', 'clear'].forEach(look => {
            expect(markup).toContain(`data-ponder-bravais-tools-panel="${look}"`);
        });
        expect(markup).toContain('data-ponder-bravais-window=');
        expect(markup).toContain('data-ponder-bravais-lattice');
        [
            'wall-panned', 'wall-scrolled', 'tab-out', 'tab-seam', 'tab-in-0', 'artist-color', 'open-ring-0', 'open-seam',
            'back-ring-0', 'focus-expanded', 'focus-playing', 'tools-dock', 'tools-open', 'look-windows', 'look-clear', 'look-solid',
            'lattice-handoff',
        ].forEach(state => {
            expect(markup).toContain(`data-ponder-surface-state="${state}"`);
        });
    });

    it('控制栏设置画的是滑杆加「在播放页拖动调整」，不是泛化的下拉框', () => {
        const markup = renderSurface('bottom-ui-settings');
        expect(markup).toContain('data-ponder-bottom-ui-settings');
        expect(markup).toContain('data-ponder-bottom-ui-offset-track');
        expect(markup).toContain('data-ponder-bottom-ui-reposition');
        expect(markup).not.toContain('data-ponder-picker-field');
    });

    it('底部控制条是完整尺寸的合成胶囊，播放键、标题、进度条和两个槽位都在', () => {
        const markup = renderSurface('player-bar');
        expect(markup).toContain('data-ponder-player-bar-structure');
        ['play', 'title', 'progress'].forEach(part => {
            expect(markup).toContain(`data-ponder-bar-${part}`);
        });
        // 槽位层、随机层、音量层、按住层各画一对，所以是 8 个；同一时刻只有一层是可见的。
        expect(markup.match(/data-ponder-bar-slot=/g)).toHaveLength(8);
        // 随机和音量不按槽位里此刻放着什么筛，两层都必须预渲染在场。
        ['title-hovered', 'slots-shuffle', 'slots-volume', 'slots-holding', 'collapsed'].forEach(state => {
            expect(markup).toContain(`data-ponder-surface-state="${state}"`);
        });
        // 按住层的外圈只画在第一个槽位上：讲的是「按住这一颗」。
        expect(markup.match(/data-ponder-bar-slot-hold/g)).toHaveLength(1);
    });

    it('胶囊上方那排快捷操作是六个操作加最右一颗命令窗口', () => {
        const markup = renderSurface('capsule-quick-actions');
        expect(markup).toContain('data-ponder-capsule-quick-actions');
        expect(markup.match(/data-ponder-quick-action(?=[\s>=])/g)).toHaveLength(6);
        expect(markup).toContain('data-ponder-quick-palette');
    });

    it('从胶囊长出来的命令窗口，输入行在结果下面', () => {
        const markup = renderSurface('capsule-palette');
        expect(markup).toContain('data-ponder-capsule-palette');
        expect(markup.match(/data-ponder-capsule-palette-row/g)).toHaveLength(3);
        expect(markup.indexOf('data-ponder-capsule-palette-input'))
            .toBeGreaterThan(markup.lastIndexOf('data-ponder-capsule-palette-row'));
    });

    it('换按钮的浮层一格一个可放的动作', () => {
        const markup = renderSurface('slot-picker');
        expect(markup).toContain('data-ponder-slot-picker');
        expect(markup.match(/data-ponder-slot-picker-option/g)).toHaveLength(11);
    });

    it('自定义快捷键画的是两颗键帽加一个下拉，Alt 那颗是印死的', () => {
        const markup = renderSurface('custom-shortcut-settings');
        expect(markup).toContain('data-ponder-custom-shortcut-structure');
        expect(markup).toContain('data-ponder-shortcut-alt');
        expect(markup).toContain('data-ponder-shortcut-key');
        expect(markup).toContain('data-ponder-shortcut-command');
        // 被退回的那颗字母、以及筛过的命令列表，是这一组仅有的两件界面上没写的事。
        ['key-refused', 'command-list'].forEach(state => {
            expect(markup).toContain(`data-ponder-surface-state="${state}"`);
        });
    });

    it('固定命令的结果层画的是命令窗口本身，列表和那一排分属两块', () => {
        const markup = renderSurface('pinned-commands-settings');
        expect(markup).toContain('data-ponder-pinned-commands-structure');
        expect(markup.match(/data-ponder-pinned-slot-/g)).toHaveLength(3);
        expect(markup).toContain('data-ponder-pinned-palette-list');
        expect(markup.match(/data-ponder-pinned-chip/g)).toHaveLength(3);
        expect(markup).toContain('data-ponder-surface-state="palette-preview"');
    });

    it('音频增益的结果层是来源页上那一小块，带分贝那一行', () => {
        const markup = renderSurface('replay-gain-settings');
        expect(markup).toContain('data-ponder-replay-gain-structure');
        ['off', 'track', 'album'].forEach(mode => {
            expect(markup).toContain(`data-ponder-replay-gain-${mode}`);
        });
        // 没有这一行就讲不出「模式选了却没生效，是这首歌没带标签」。
        expect(markup).toContain('data-ponder-replay-gain-summary');
        expect(markup).toContain('data-ponder-surface-state="panel-mirror"');
    });

    it('备份与导入带一个逐项对照框，衍生改动单独一块', () => {
        const markup = renderSurface('import-export-settings');
        expect(markup).toContain('data-ponder-import-export-structure');
        expect(markup).toContain('data-ponder-import-textarea');
        expect(markup).toContain('data-ponder-import-button');
        expect(markup).toContain('data-ponder-import-dialog');
        // 勾不掉的那几条是这个确认框存在的理由，所以它们得自成一块。
        expect(markup).toContain('data-ponder-import-derived-block');
        expect(markup.match(/data-ponder-import-derived="true"/g)).toHaveLength(2);
        expect(markup).toContain('data-ponder-surface-state="import-plan"');
    });

    it('音频效果器把预设排和推子排画在同一张图上，换槽是一整层结果', () => {
        const markup = renderSurface('audio-equalizer');
        expect(markup).toContain('data-ponder-audio-equalizer-structure');
        expect(markup).toContain('data-ponder-eq-presets');
        expect(markup).toContain('data-ponder-eq-custom-slots');
        // 两排各十根：拖之前一层、拖之后一层，同一时刻只有一层看得见。
        expect(markup.match(/data-ponder-eq-band(?![-a-z])/g)).toHaveLength(20);
        expect(markup).toContain('data-ponder-surface-state="custom-written"');
    });

    it('歌词样式窗口的热区平时不画边框，只有结果层才把它们亮出来', () => {
        const markup = renderSurface('vis-playground');
        expect(markup).toContain('data-ponder-vis-playground-structure');
        ['background', 'visualizer', 'subtitle'].forEach(region => {
            expect(markup).toContain(`data-ponder-playground-hotspot-${region}`);
        });
        // 三块显形的边框只在那一层里；基础层画出来就等于把这一章讲反了。
        expect(markup.match(/data-ponder-playground-hotspot-shown/g)).toHaveLength(3);
        expect(markup).toContain('data-ponder-surface-state="hotspots-visible"');

        // 右栏四页各是一层，而且每层都带一颗只管本页的「默认」。
        ['section-background', 'section-common', 'section-subtitle'].forEach(state => {
            expect(markup).toContain(`data-ponder-surface-state="${state}"`);
        });
        expect(markup.match(/data-ponder-playground-section-reset/g)).toHaveLength(4);
        // 「通用」那一层：预览文本和歌词字体两行是这一页独有的。
        expect(markup).toContain('data-ponder-playground-preview-text');
        expect(markup).toContain('data-ponder-playground-font');
        // 字幕页的内容三选一，和那颗决定字体跟不跟歌词走的开关。
        expect(markup).toContain('data-ponder-playground-subtitle-content');
        expect(markup).toContain('data-ponder-playground-subtitle-font');
    });

    it('Theme Park 标题栏三件齐全，保存灰掉那层同时在「信息」标签旁亮出圆点', () => {
        const markup = renderSurface('theme-park');
        expect(markup).toContain('data-ponder-theme-park-structure');
        ['target', 'reset', 'save'].forEach(part => {
            expect(markup).toContain(`data-ponder-park-${part}`);
        });
        expect(markup).toContain('data-ponder-park-mode');
        expect(markup.match(/data-ponder-park-color-well/g)).toHaveLength(4);
        // 按不动的那颗和能解决它的那一格必须在同一层里，否则连不成一句话。
        expect(markup).toContain('data-ponder-park-save-blocked');
        expect(markup).toContain('data-ponder-park-tab-details');
        expect(markup).toContain('data-ponder-surface-state="save-blocked"');
    });

    it('控制面板多出两副面孔：展开的模式列表，和 FM 下的电台页', () => {
        const markup = renderSurface('side-panel');
        // 歌词样式那一行中间是一颗按钮，它得是一块独立元素才指得住。
        expect(markup).toContain('data-ponder-panel-mode-name');
        // 点开是三列两排的一格图。
        expect(markup.match(/data-ponder-panel-mode-option/g)).toHaveLength(6);
        // 图底下那一条是「更多设置」，不是第七张图。
        expect(markup).toContain('data-ponder-panel-mode-list-footer');
        expect(markup).toContain('data-ponder-surface-state="controls-mode-list"');

        // 电台页没有队列行，只有一颗写着模式的按钮、三颗传送和两端的丢弃、喜欢。
        expect(markup).toContain('data-ponder-panel-fm-mode');
        expect(markup).toContain('data-ponder-panel-fm-transport');
        expect(markup.match(/data-ponder-panel-fm-action(?![-a-z])/g)).toHaveLength(2);
        expect(markup).toContain('data-ponder-surface-state="fm-tab"');
    });

    it('GridView surface 使用蜂窝卡片，并包含信息与筛选结果', () => {
        const markup = renderSurface('grid-view-page');
        expect(markup).toContain('data-ponder-grid-view-page-structure');
        expect(markup).toContain('data-ponder-grid-view-cards');
        ['card-focused', 'info-open', 'filter-open'].forEach(state => {
            expect(markup).toContain(`data-ponder-surface-state="${state}"`);
        });
    });
});

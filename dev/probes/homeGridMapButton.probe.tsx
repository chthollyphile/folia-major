import React from 'react';
import '../../src/i18n/config';
import DesktopGrid3DSurface from '../../src/components/folia-grid/DesktopGrid3DSurface';
import type { Grid3DSliderItem } from '../../src/components/folia-grid/Grid3DSlider';
import { DEFAULT_THEME } from '../../src/services/baseThemes';
import type { ProbeDefinition } from './definition';
// dev/probes/homeGridMapButton.probe.tsx

/**
 * 首页 3D 歌单滑轨顶部的「全部」按钮（打开 GridMap 2D 视图）的液态玻璃探针。
 *
 * 真实首页需要登录或本地曲库才有这个按钮，headless 截图脚本（liquid-glass-shot.mjs）
 * 够不到；这里挂一个假数据的 DesktopGrid3DSurface，让玻璃表面进入标准截图清单。
 * 同时用于确认 isLoading 切换时按钮的挂载/摘除不泄漏 RO。
 */
const PROBE_ITEMS: Grid3DSliderItem[] = [1, 2, 3].map(index => ({
    id: `probe-playlist-${index}`,
    name: `Probe Playlist ${index}`,
    type: 'playlist',
    trackCount: 10 * index,
}));

const HomeGridMapButtonProbe: React.FC = () => {
    const [focusedIndex, setFocusedIndex] = React.useState(0);
    const [isLoading, setIsLoading] = React.useState(false);

    return (
        <div className="relative h-screen bg-zinc-900">
            <div className="absolute left-4 top-4 z-[80] flex gap-2">
                <button type="button" data-probe-action="toggle-loading" onClick={() => setIsLoading(value => !value)}>
                    toggle loading
                </button>
            </div>
            <div className="absolute inset-x-0 bottom-24 top-16">
                <DesktopGrid3DSurface
                    title="Probe Playlists"
                    mapButtonLabel="全部"
                    items={PROBE_ITEMS}
                    focusedIndex={focusedIndex}
                    onFocusedIndexChange={setFocusedIndex}
                    onSelect={() => { }}
                    isLoading={isLoading}
                    theme={DEFAULT_THEME}
                    isDaylight={false}
                />
            </div>
        </div>
    );
};

const definition: ProbeDefinition = {
    id: 'homeGridMapButton',
    title: '首页「全部」按钮 · 3D/2D 视图切换的液态玻璃',
    description: 'DesktopGrid3DSurface 顶部「全部」按钮的玻璃折射、rim 高光与 isLoading 挂载切换。',
    Component: HomeGridMapButtonProbe,
};

export default definition;

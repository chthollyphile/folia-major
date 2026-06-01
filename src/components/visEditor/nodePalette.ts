import type { AddComplexNodeRequest } from './flowModel';
import { VISUALIZER_REGISTRY } from '../visualizer/registry';

// src/components/visEditor/nodePalette.ts
// Defines the node creation menu used by the flow editor context menu.
export interface NodePaletteGroup {
    title: string;
    items: AddComplexNodeRequest[];
}

export const buildNodePaletteGroups = (): NodePaletteGroup[] => [
    {
        title: '输入',
        items: [
            { role: 'input', kind: 'theme', label: '主题输入' },
            { role: 'input', kind: 'audio', label: '音频输入' },
            { role: 'input', kind: 'lyrics', label: '歌词输入' },
            { role: 'input', kind: 'song', label: '歌曲信息' },
            { role: 'input', kind: 'playback', label: '播放时间' },
        ],
    },
    {
        title: '背景层',
        items: [
            { role: 'visualizerBg', kind: 'solidTheme', label: '主题背景' },
            { role: 'visualizerBg', kind: 'coverFluid', label: '封面流体背景' },
            { role: 'visualizerBg', kind: 'geometric', label: '几何背景' },
            { role: 'visualizerBg', kind: 'vignette', label: '暗角' },
        ],
    },
    {
        title: '歌词层',
        items: VISUALIZER_REGISTRY.map(entry => ({
            role: 'visualizerMain',
            mode: entry.mode,
            label: entry.labelFallback,
        })),
    },
    {
        title: '装饰层',
        items: [
            { role: 'visualizerOverlay', kind: 'subtitle', label: '字幕叠加' },
        ],
    },
];

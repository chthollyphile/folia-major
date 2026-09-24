import { defineCommand } from '../commandFactories';
import { backgroundPickerSurface, visualizerPickerSurface } from '../surfaces/pickerSurface';
import { LayoutGrid, Wallpaper } from 'lucide-react';
import type { CommandPaletteCommand } from '../types';
import { createToggleCommand, createVisualizerCommand } from '../commandFactories';
import { lyricSegmentationCommand } from './lyricSegmentationCommand';

// src/components/command-palette/commands/visualizerCommands.ts
// Commands in the `visualizer` group: switching lyric animation modes and background layouts.

export const visualizerCommands: CommandPaletteCommand[] = [
    lyricSegmentationCommand,
    defineCommand({
        id: 'visualizer-picker',
        executeShortcut: 'm',
        group: 'visualizer',
        title: 'Pick a visualizer',
        description: 'Browse lyric animation modes and click one to switch',
        keywords: ['visualizer picker', 'pick visualizer', 'browse visualizers', '可视化选择器', '选择可视化', '歌词动画选择'],
        icon: LayoutGrid,
        requiresInput: true,
        surface: visualizerPickerSurface,
        placeholder: context => context.shared.t('commandPalette.pickerFilterPlaceholder', 'Type to filter, then click or press Enter'),
        execute: () => false,
    }),
    defineCommand({
        id: 'background-picker',
        executeShortcut: 'g',
        group: 'visualizer',
        title: 'Pick a background',
        description: 'Browse background layouts and click one to switch',
        keywords: ['background picker', 'pick background', 'browse backgrounds', '背景选择器', '选择背景'],
        icon: Wallpaper,
        requiresInput: true,
        surface: backgroundPickerSurface,
        placeholder: context => context.shared.t('commandPalette.pickerFilterPlaceholder', 'Type to filter, then click or press Enter'),
        execute: () => false,
    }),
    createVisualizerCommand('sonnet', 'Visualizer: Sonnet', 'Switch to Sonnet visualizer', ['sonnet', '商籁', '文字 pv', 'mg pv', 'vocaloid']),
    createVisualizerCommand('tempera', 'Visualizer: Tempera', 'Switch to Tempera visualizer', ['tempera', '凝彩', 'dancai', 'dc', '色块 pv', 'block pv']),
    createVisualizerCommand('classic', 'Visualizer: Luminous', 'Switch to classic visualizer', ['visualizer classic', 'classic', '流光']),
    createVisualizerCommand('cadenza', 'Visualizer: Mindscape', 'Switch to cadenza visualizer', ['visualizer cadenza', 'cadenza', 'mindscape', '心象']),
    createVisualizerCommand('partita', 'Visualizer: Partita', 'Switch to partita visualizer', ['partita', '云阶']),
    createVisualizerCommand('fume', 'Visualizer: Fume', 'Switch to fume visualizer', ['fume', '浮名']),
    createVisualizerCommand('tilt', 'Visualizer: Tilt', 'Switch to tilt visualizer', ['tilt', '倾诉']),
    createVisualizerCommand('claddagh', 'Visualizer: Claddagh', 'Switch to Claddagh visualizer', ['claddagh', '回环']),
    createVisualizerCommand('monet', 'Visualizer: Monet', 'Switch to Monet visualizer', ['monet', '莫奈', '切换到可视化：莫奈', '切换到可视化莫奈']),
    createVisualizerCommand('pendolo', 'Visualizer: Pendolo', 'Switch to Pendolo visualizer', ['pendolo', '擒纵', '摆轮', 'pd', '切换到可视化：擒纵', '切换到可视化擒纵']),
    createVisualizerCommand('cappella', 'Visualizer: Cappella', 'Switch to cappella visualizer', ['cappella', '群唱']),
    createVisualizerCommand('diorama', 'Visualizer: Diorama', 'Switch to Diorama visualizer', ['diorama', '镜台', '切换到可视化：镜台', '切换到可视化镜台']),
    createVisualizerCommand('still', 'Visualizer: Still', 'Switch to the static low-resource visualizer', ['still', 'static', 'low resource', '静止', '静态', '低占用']),
    createToggleCommand('video-layer-toggle', 'visualizer', 'Video layer behind lyrics', 'Show or hide the muted video layer behind the lyrics', ['video layer', 'background video', 'video behind lyrics', '视频层', '背景视频', '歌词后方视频'], context => context.visualizer.toggleVideoLayer()),
    defineCommand({
        id: 'video-layer-pick',
        group: 'visualizer',
        title: 'Video layer: pick a local video',
        description: 'Choose a local video to play behind the lyrics',
        keywords: ['pick video', 'local video', 'video layer', 'mv', '选择视频', '本地视频', '视频层', '背景视频'],
        execute: (_input, context) => {
            void context.visualizer.pickVideoLayerFile().catch((error) => {
                console.error('[VideoLayer] Failed to pick a video:', error);
            });
            return true;
        },
    }),
    createToggleCommand('visualizer-toggle-random-per-song', 'visualizer', 'Random visualizer for every song', 'Toggle a random lyric animation mode whenever the song changes', ['random visualizer', 'random animation', 'per song', '随机歌词动画', '每首歌随机动画'], context => context.visualizer.toggleRandomVisualizerModePerSong()),
    {
        id: 'background-monet-full-overlay',
        group: 'visualizer',
        title: 'Background: Monet Full Screen Overlay',
        description: 'Switch background to Monet full screen overlay layout',
        keywords: ['monet full screen', 'monet full', 'overlay', '莫奈全屏叠色', '全屏叠色', '莫奈', '背景切换到 莫奈: 全屏叠色', '背景切换到莫奈全屏叠色'],
        execute: (_input, context) => {
            context.visualizer.setVisualizerBackgroundMode('monet');
            context.visualizer.setMonetBackgroundTuning({ backgroundLayout: 'full-overlay' });
            return true;
        },
    },
    {
        id: 'background-monet-half-gradient',
        group: 'visualizer',
        title: 'Background: Monet Half Screen Gradient',
        description: 'Switch background to Monet half screen gradient layout',
        keywords: ['monet half screen', 'monet half', 'gradient', '莫奈半屏渐变', '半屏渐变', '莫奈', '背景切换到 莫奈: 半屏渐变', '背景切换到莫奈半屏渐变'],
        execute: (_input, context) => {
            context.visualizer.setVisualizerBackgroundMode('monet');
            context.visualizer.setMonetBackgroundTuning({ backgroundLayout: 'half-pane-gradient' });
            return true;
        },
    },
    {
        id: 'background-common',
        group: 'visualizer',
        title: 'Background: Common',
        description: 'Switch background to general layout',
        keywords: ['background general', 'common', 'general', '通用背景', 'ty', '背景切换到 通用', '背景切换到通用'],
        execute: (_input, context) => {
            context.visualizer.setVisualizerBackgroundMode('common');
            return true;
        },
    },
    {
        id: 'background-nomand',
        group: 'visualizer',
        title: 'Background: Nomand',
        description: 'Switch background to theme-colored image dithering',
        keywords: ['nomand', 'dithering', 'dither', 'shader background', '漫游', '像素画', '像素画背景', '抖动背景', '网点背景', '主题色背景'],
        execute: (_input, context) => {
            context.visualizer.setVisualizerBackgroundMode('nomand');
            return true;
        },
    },
    {
        id: 'background-latent',
        group: 'visualizer',
        title: 'Background: Latent',
        description: 'Switch background to cover-colored audio-reactive shaders',
        keywords: ['latent', 'latent background', 'shader background', '隐现', '隐现背景', '音频响应背景'],
        execute: (_input, context) => {
            context.visualizer.setVisualizerBackgroundMode('latent');
            return true;
        },
    },
    {
        id: 'background-latent-dithering',
        group: 'visualizer',
        title: 'Latent: Pixel',
        description: 'Show only the Dithering layer in Latent background',
        keywords: ['latent dithering', '隐现像素', '像素层'],
        execute: (_input, context) => {
            context.visualizer.setVisualizerBackgroundMode('latent');
            context.visualizer.setLatentBackgroundTuning({ displayMode: 'dithering' });
            return true;
        },
    },
    {
        id: 'background-latent-mesh',
        group: 'visualizer',
        title: 'Latent: Fluid',
        description: 'Show only the MeshGradient layer in Latent background',
        keywords: ['latent mesh', 'mesh gradient', '隐现流体', '流体层'],
        execute: (_input, context) => {
            context.visualizer.setVisualizerBackgroundMode('latent');
            context.visualizer.setLatentBackgroundTuning({ displayMode: 'mesh' });
            return true;
        },
    },
    {
        id: 'background-latent-both',
        group: 'visualizer',
        title: 'Latent: Mixed',
        description: 'Show both shader layers in Latent background',
        keywords: ['latent both', '隐现混合', '双层背景'],
        execute: (_input, context) => {
            context.visualizer.setVisualizerBackgroundMode('latent');
            context.visualizer.setLatentBackgroundTuning({ displayMode: 'both' });
            return true;
        },
    },
    {
        id: 'background-url',
        group: 'visualizer',
        title: 'Background: Embedded Background',
        description: 'Switch background to embedded webpage mode',
        keywords: ['embedded background', 'embed background', 'background embed', 'background url', 'url background', 'url', 'webpage', '嵌入背景', '网页背景', '背景切换到 嵌入背景', '背景切换到嵌入背景'],
        execute: (_input, context) => {
            context.visualizer.setVisualizerBackgroundMode('url');
            return true;
        },
    },
    {
        id: 'background-sora',
        group: 'visualizer',
        title: 'Background: Sora',
        description: 'Switch background to Sora (starry sky) layout',
        keywords: ['sora', 'starry sky', 'star', '星空', '空', '背景切换到 空', '背景切换到空', '背景切换到Sora', '背景切换到星空'],
        execute: (_input, context) => {
            context.visualizer.setVisualizerBackgroundMode('sora');
            return true;
        },
    }
];

import { defineCommand } from '../commandFactories';
import { backgroundPickerSurface, visualizerPickerSurface } from '../surfaces/pickerSurface';
import { LayoutGrid, Wallpaper } from 'lucide-react';
import type { CommandPaletteCommand } from '../types';
import { createBackgroundCommand, createToggleCommand, createVisualizerCommand } from '../commandFactories';
import { lyricSegmentationCommand } from './lyricSegmentationCommand';
import { VISUALIZER_REGISTRY } from '../../visualizer/registry';
import { VISUALIZER_BACKGROUND_REGISTRY } from '../../visualizer/backgrounds/registry';

// src/components/command-palette/commands/visualizerCommands.ts
// Commands in the `visualizer` group: switching lyric animation modes and background layouts.
//
// The command that switches to a lyric style or to a background is written in that mode's own
// entry.tsx (`command`) and listed here in registry order, so a new mode adds no line to this file.
// A mod's mode has no command of its own; the two pickers list it.

// Latent's three display variants. They are listed right after Latent's own switch command.
const LATENT_VARIANT_COMMANDS: CommandPaletteCommand[] = [
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
];

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
    ...VISUALIZER_REGISTRY.flatMap(({ mode, command }) => (
        command ? [createVisualizerCommand(mode, command.title, command.description, command.keywords)] : []
    )),
    createToggleCommand('smart-beat-toggle', 'visualizer', 'Smart beat mode', 'Turn beat_this-driven beat FX (Sonnet, Diorama particles, Latent background) on or off', ['smart beat', 'beat fx', 'beat this', 'sonnet beat', 'diorama beat', 'latent beat', '智能动感模式', '动感', '节拍', '商籁动感', '镜台涟漪', '隐现', '重拍', '轻拍'], context => context.visualizer.toggleSmartBeat()),
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
    createToggleCommand(
        'visualizer-toggle-glow-blur-quantize',
        'visualizer',
        'Fix lyric animation freeze on Linux',
        'Change how some lyric animations draw their glow, fixing occasional freezes after long playback on Linux',
        ['lyric freeze', 'freeze fix', 'linux', 'glow', 'fd leak', 'stepped glow', '歌词卡死', '动画卡死', '画面定格', '发光半径分档', '发光', 'faguangbanjing', 'fgbj'],
        context => context.visualizer.toggleGlowBlurQuantize(),
    ),
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
    // Monet has no plain switch command (the two above pick a layout); Latent's variants follow its own.
    ...VISUALIZER_BACKGROUND_REGISTRY.flatMap(({ mode, command }) => [
        ...(command ? [createBackgroundCommand(mode, command.title, command.description, command.keywords)] : []),
        ...(mode === 'latent' ? LATENT_VARIANT_COMMANDS : []),
    ]),
];

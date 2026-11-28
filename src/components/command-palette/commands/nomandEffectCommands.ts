import type { CommandPaletteCommand } from '../types';
import type { NomandBackgroundEffect } from '../../../types';

// src/components/command-palette/commands/nomandEffectCommands.ts
// 漫游背景的六种效果，一种一条命令：切到漫游并换上那个效果。列在漫游自己的切换命令后面。
// 关键词写成字面量，构建期的拼音插件才扫得到（它只读 commands/ 下的字面量）。

const nomandEffectCommand = (
    id: string,
    effect: NomandBackgroundEffect,
    title: string,
    description: string,
    keywords: string[],
): CommandPaletteCommand => ({
    id,
    group: 'visualizer',
    title,
    description,
    keywords,
    execute: (_input, context) => {
        context.visualizer.setVisualizerBackgroundMode('nomand');
        context.visualizer.setNomandBackgroundTuning({ effect });
        return true;
    },
});

export const NOMAND_EFFECT_COMMANDS: CommandPaletteCommand[] = [
    nomandEffectCommand('background-nomand-dithering', 'dithering', 'Nomand: Dithering', 'Draw the Nomand picture as an ordered dither in theme colors', ['nomand dithering', 'pixel art background', '漫游像素画', '像素画']),
    nomandEffectCommand('background-nomand-fluted-glass', 'fluted-glass', 'Nomand: Fluted Glass', 'Show the Nomand picture through ribbed glass', ['nomand fluted glass', 'ribbed glass', '漫游纹理玻璃', '纹理玻璃']),
    nomandEffectCommand('background-nomand-paper-texture', 'paper-texture', 'Nomand: Paper Texture', 'Print the Nomand picture on textured paper', ['nomand paper texture', 'paper grain', '漫游纸张纹理', '纸张纹理']),
    nomandEffectCommand('background-nomand-halftone-dots', 'halftone-dots', 'Nomand: Halftone Dots', 'Print the Nomand picture as halftone dots', ['nomand halftone', 'halftone dots', '漫游半调网点', '半调网点', '网点背景']),
    nomandEffectCommand('background-nomand-lens-distortion', 'lens-distortion', 'Nomand: Lens Distortion', 'Bend the Nomand picture through a lens with color dispersion', ['nomand lens distortion', 'chromatic aberration', '漫游镜头畸变', '镜头畸变']),
    nomandEffectCommand('background-nomand-ascii', 'ascii', 'Nomand: ASCII', 'Draw the Nomand picture as swaying ASCII glyphs', ['nomand ascii', 'ascii art background', 'text art', '漫游字符画', '字符画', '字符背景']),
];

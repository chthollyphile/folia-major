import { describe, expect, it } from 'vitest';
import type { Theme } from '@/types';
import {
    contrastRatio,
    ensureContrast,
    hanabiBackdropOf,
    MIN_FLASH_CONTRAST,
    MIN_SUNG_CONTRAST,
    resolveHanabiGlyphColors,
    resolveHanabiPalette,
} from '@/components/visualizer/hanabi/color';
import { HANABI_PROFILES } from '@/components/visualizer/hanabi/catalog';
import { blockTextRole } from '@/components/visualizer/hanabi/text/blocks';

// test/unit/visualizer/hanabi/hanabiGlyphColors.test.ts
// 花火的字色按身后的色块挑：被唱到变的颜色、闪一下、翻牌背面、平时的字色都不能和色块同色。
// 回归：「混合」配色下第一块色块与强调色都取自主题强调色，唱完的字（sing: color）变成色块的颜色、看不见
// （obi-ticket 的票据、yanagi-palm 的胶囊，修之前 7720 种组合里 433 种对比度不到 2）。

const ACCENTS = ['#ea580c', '#f97316', '#22c55e', '#ec4899', '#3b82f6', '#a855f7', '#eab308', '#14b8a6', '#f4f4f5', '#ef4444'];
const BACKGROUNDS = ['#0b0d24', '#f5f1ea'];
const MODES = ['theme', 'vivid', 'mixed'] as const;

const themeOf = (accentColor: string, backgroundColor: string): Theme => ({
    name: 'probe', backgroundColor, primaryColor: '#ffffff', accentColor, secondaryColor: '#60a5fa', fontStyle: 'sans', animationIntensity: 'normal',
});

describe('花火的字色', () => {
    it('所有预设、配色、主题下，字色与被唱到的颜色和身后的色块对比度都够', () => {
        let checked = 0;
        for (const accent of ACCENTS) for (const background of BACKGROUNDS) for (const mode of MODES) {
            const theme = themeOf(accent, background);
            for (const profile of HANABI_PROFILES) {
                const palette = resolveHanabiPalette(profile.palette, theme, mode);
                const base = blockTextRole(profile.text.block) === 'ink' ? palette.ink : palette.paper;
                const unders = profile.text.block === 'none' ? [hanabiBackdropOf(palette)] : palette.blocks;
                for (const under of unders) {
                    const colors = resolveHanabiGlyphColors(palette, base, under);
                    expect(contrastRatio(colors.ink, under)).toBeGreaterThanOrEqual(MIN_SUNG_CONTRAST);
                    expect(contrastRatio(colors.sung, under)).toBeGreaterThanOrEqual(MIN_SUNG_CONTRAST);
                    expect(contrastRatio(colors.flash, under)).toBeGreaterThanOrEqual(MIN_FLASH_CONTRAST);
                    expect(contrastRatio(colors.back, under)).toBeGreaterThanOrEqual(MIN_FLASH_CONTRAST);
                    checked += 1;
                }
            }
        }
        expect(checked).toBeGreaterThan(7000);
    });

    it('与色块同色的强调色被推开，色块是别的颜色时照用强调色', () => {
        const palette = resolveHanabiPalette('festival', themeOf('#ea580c', '#0b0d24'), 'mixed');
        const block = palette.blocks[0]!;
        // 混合配色下第一块色块就是主题强调色调出来的，强调色在它上面看不清。
        expect(contrastRatio(palette.accent, block)).toBeLessThan(MIN_SUNG_CONTRAST);
        const onBlock = resolveHanabiGlyphColors(palette, palette.ink, block);
        expect(onBlock.sung).not.toBe(palette.accent);
        const onSky = resolveHanabiGlyphColors(palette, palette.paper, hanabiBackdropOf(palette));
        expect(contrastRatio(onSky.sung, hanabiBackdropOf(palette))).toBeGreaterThanOrEqual(MIN_SUNG_CONTRAST);
    });

    it('推开时色相不变，已经够了的不动', () => {
        expect(ensureContrast(0xffffff, 0x000000, 3)).toBe(0xffffff);
        const pushed = ensureContrast(0xf2a65a, 0xf0a050, 3);
        expect(contrastRatio(pushed, 0xf0a050)).toBeGreaterThanOrEqual(3);
        // 橙色推暗后仍是红多绿多于蓝。
        expect((pushed >> 16) & 255).toBeGreaterThan(pushed & 255);
    });
});

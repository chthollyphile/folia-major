// Copyright (c) 2026 chthollyphile
import { describe, expect, it } from 'vitest';
import type { Theme } from '@/types';
import { BLOCK_LABELS, BURST_KINDS, ENTER_LABELS, HANABI_FAMILY_DESCRIPTIONS, HANABI_FAMILY_LABELS, HANABI_PROFILES } from '@/components/visualizer/hanabi/catalog';
import { contrastRatio, MIN_BLOCK_CONTRAST, PALETTE_ROLES, resolveHanabiPalette } from '@/components/visualizer/hanabi/color';
import type { ExitFx, OrnamentKind, SingFx, TextLayout } from '@/components/visualizer/hanabi/types';

// test/unit/visualizer/hanabi/hanabiCatalog.test.ts
// 花火的预设目录（取自 lumisynth 的 hanabiCatalog 单测）：50 个、kind 唯一、每种部件至少两个预设用到、组合互不相同、
// 文字区在画面内、调色板对比度。

const LAYOUTS: TextLayout[] = ['center', 'left', 'right', 'stagger', 'diagonal', 'scatter', 'vertical', 'vertical-split', 'arc'];
const SINGS: SingFx[] = ['none', 'bounce', 'flash', 'swell', 'shake', 'jump', 'glow', 'underline', 'color'];
const EXITS: ExitFx[] = ['ascend', 'scatter', 'shrink', 'slide', 'dissolve', 'fall', 'blink'];
const ORNAMENTS: OrnamentKind[] = [
    'ring', 'spokes', 'sparkle', 'orbit', 'chevrons', 'brackets', 'cross', 'zigzag', 'wave', 'halftone', 'confetti',
    'shards', 'dash-circle', 'squares', 'streaks', 'petals', 'stamp', 'rays', 'underline', 'dots-line', 'glints',
];

const countBy = <T extends string>(values: T[]) => values.reduce<Record<string, number>>((map, value) => {
    map[value] = (map[value] ?? 0) + 1;
    return map;
}, {});

const expectAtLeastTwo = (all: readonly string[], used: string[]) => {
    const counts = countBy(used);
    const missing = all.filter(item => (counts[item] ?? 0) < 2);
    expect(missing).toEqual([]);
};

describe('花火的预设目录', () => {
    it('10 族 × 5 = 50 个，kind 唯一，族都有名字与描述', () => {
        expect(HANABI_PROFILES).toHaveLength(50);
        expect(new Set(HANABI_PROFILES.map(profile => profile.kind)).size).toBe(50);
        const families = countBy(HANABI_PROFILES.map(profile => profile.family));
        expect(Object.keys(families)).toHaveLength(10);
        Object.entries(families).forEach(([family, count]) => {
            expect(count).toBe(5);
            expect(HANABI_FAMILY_LABELS[family]).toBeTruthy();
            expect(HANABI_FAMILY_DESCRIPTIONS[family]).toBeTruthy();
        });
        HANABI_PROFILES.forEach(profile => {
            expect(profile.kind).toMatch(/^[a-z]+(-[a-z]+)+$/);
            expect(profile.kind.startsWith(`${profile.family}-`)).toBe(true);
            expect(profile.label).toBeTruthy();
        });
    });

    it('每种入场、色块、烟花、装饰件、排法、强调、退场、配色都至少被两个预设用到', () => {
        expectAtLeastTwo(Object.keys(ENTER_LABELS), HANABI_PROFILES.map(profile => profile.text.enter));
        expectAtLeastTwo(Object.keys(BLOCK_LABELS), HANABI_PROFILES.map(profile => profile.text.block));
        expectAtLeastTwo(BURST_KINDS, HANABI_PROFILES.flatMap(profile => (profile.burst ? [profile.burst.kind] : [])));
        expectAtLeastTwo(ORNAMENTS, HANABI_PROFILES.flatMap(profile => profile.ornaments.map(ornament => ornament.kind)));
        expectAtLeastTwo(LAYOUTS, HANABI_PROFILES.map(profile => profile.text.layout));
        expectAtLeastTwo(SINGS, HANABI_PROFILES.map(profile => profile.text.sing));
        expectAtLeastTwo(EXITS, HANABI_PROFILES.map(profile => profile.text.exit));
        expectAtLeastTwo(PALETTE_ROLES, HANABI_PROFILES.map(profile => profile.palette));
    });

    it('（排法、色块、入场、主烟花）组合互不相同', () => {
        const combos = HANABI_PROFILES.map(profile => [profile.text.layout, profile.text.block, profile.text.enter, profile.burst?.kind ?? 'none'].join('|'));
        expect(new Set(combos).size).toBe(combos.length);
    });

    it('mood 三种都有且分布均衡；每个预设 2–4 个装饰件、参数在范围内', () => {
        const moods = countBy(HANABI_PROFILES.map(profile => profile.mood));
        for (const mood of ['quiet', 'neutral', 'loud']) expect(moods[mood]).toBeGreaterThanOrEqual(12);
        HANABI_PROFILES.forEach(profile => {
            expect(profile.ornaments.length).toBeGreaterThanOrEqual(2);
            expect(profile.ornaments.length).toBeLessThanOrEqual(4);
            expect(profile.text.heroSize).toBeGreaterThanOrEqual(0.06);
            expect(profile.text.heroSize).toBeLessThanOrEqual(0.2);
            expect(profile.camera.rise).toBeGreaterThanOrEqual(0.2);
            expect(profile.camera.rise).toBeLessThanOrEqual(0.9);
            profile.ornaments.forEach(ornament => {
                expect(ornament.density).toBeGreaterThanOrEqual(0);
                expect(ornament.density).toBeLessThanOrEqual(1);
            });
        });
    });

    it('文字区在画面内，离边缘至少 5%', () => {
        HANABI_PROFILES.forEach(({ kind, region }) => {
            expect(region.cx - region.w / 2, kind).toBeGreaterThanOrEqual(0.05);
            expect(region.cx + region.w / 2, kind).toBeLessThanOrEqual(0.95);
            expect(region.cy - region.h / 2, kind).toBeGreaterThanOrEqual(0.05);
            expect(region.cy + region.h / 2, kind).toBeLessThanOrEqual(0.95);
        });
    });
});

describe('花火的调色板', () => {
    const themes: Theme[] = [
        { name: 'dark', backgroundColor: '#0b0d1a', primaryColor: '#f5f5f5', accentColor: '#ff6f91', secondaryColor: '#8ec5ff', fontStyle: 'sans', animationIntensity: 'normal' },
        { name: 'light', backgroundColor: '#fbf7ef', primaryColor: '#1f2937', accentColor: '#f0b429', secondaryColor: '#3b82f6', fontStyle: 'serif', animationIntensity: 'calm' },
        { name: 'grey', backgroundColor: '#777777', primaryColor: '#888888', accentColor: '#808080', secondaryColor: '#7a7a7a', fontStyle: 'sans', animationIntensity: 'normal' },
    ];

    it('任何配色模式下色块与字色的对比度都够，火花 3–5 个', () => {
        for (const theme of themes) {
            for (const mode of ['theme', 'vivid', 'mixed'] as const) {
                for (const role of PALETTE_ROLES) {
                    const palette = resolveHanabiPalette(role, theme, mode);
                    palette.blocks.forEach(block => expect(contrastRatio(block, palette.ink)).toBeGreaterThanOrEqual(MIN_BLOCK_CONTRAST - 1e-6));
                    expect(palette.sparks.length).toBeGreaterThanOrEqual(3);
                    expect(palette.sparks.length).toBeLessThanOrEqual(5);
                    expect(palette.blocks.length).toBeGreaterThanOrEqual(2);
                }
            }
        }
    });

    it('纸色与背景反差：深底上是浅色，浅底上是深色', () => {
        expect(contrastRatio(resolveHanabiPalette('night', themes[0]!, 'vivid').paper, 0x0b0d1a)).toBeGreaterThan(7);
        expect(contrastRatio(resolveHanabiPalette('night', themes[1]!, 'vivid').paper, 0xfbf7ef)).toBeGreaterThan(7);
    });
});

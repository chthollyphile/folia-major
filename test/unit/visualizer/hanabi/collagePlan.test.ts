import { describe, expect, it } from 'vitest';
import {
    chooseCollageRecipe,
    pickCollageKeyword,
    planShotCollage,
    type CollagePlanInput,
    type CollageRect,
} from '@/components/visualizer/hanabi/collage/collagePlan';
import type { Line } from '@/types';

// test/unit/visualizer/hanabi/collagePlan.test.ts
// 花火 PV 拼贴的编排：确定性、数量倍率、配方轮换、拟声字不压字、开场标题卡、关键词挑选。

const palette = { ink: 0x2b1f3d, paper: 0xffffff, blocks: [0xff7eb6, 0x7fd8ff], sparks: [0xffd166, 0xff6fa5, 0x7bdff2], accent: 0xff5fa2, glow: 0xffd1e8 };

const input = (overrides: Partial<CollagePlanInput> = {}): CollagePlanInput => ({
    seed: 'probe:p0-hb1',
    family: 'kiku',
    mood: 'loud',
    isBridge: false,
    block: 'band',
    shotNumber: 1,
    bounds: { x: -220, y: -60, width: 440, height: 120 },
    screen: { x: -640, y: -360, width: 1280, height: 720 },
    unit: 720,
    palette,
    enterAt: 2.6,
    exitAt: 5.6,
    exitDuration: 0.5,
    start: 3,
    end: 6,
    keyword: '晨雾',
    motifs: ['Lantern Tide', 'HANABI', '花火'],
    bursts: [{ x: 0, y: -40, at: 2.6, kind: 'kiku', main: true, radius: 220 }],
    launches: [{ fromX: 0, fromY: 380, toX: 0, toY: -40, at: 2.15, duration: 0.45 }],
    amount: 1,
    previous: null,
    ...overrides,
});

const overlaps = (a: CollageRect, b: CollageRect) => (
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
);

describe('planShotCollage', () => {
    it('is deterministic for the same input', () => {
        expect(planShotCollage(input())).toEqual(planShotCollage(input()));
    });

    it('draws nothing when the collage amount is 0', () => {
        expect(planShotCollage(input({ amount: 0 }))).toEqual({ recipe: null, items: [] });
    });

    it('never repeats the previous shot\'s recipe for a lyric shot', () => {
        for (let k = 0; k < 40; k += 1) {
            const first = planShotCollage(input({ seed: `s${k}` }));
            const second = planShotCollage(input({ seed: `s${k}:next`, previous: first.recipe }));
            expect(second.recipe).not.toBe(first.recipe);
        }
    });

    it('keeps the burst icons of lyric shots off the lyric block', () => {
        let checked = 0;
        for (let k = 0; k < 60; k += 1) {
            const plan = planShotCollage(input({ seed: `pop${k}` }));
            plan.items.forEach(item => {
                if (item.kind !== 'pop') return;
                checked += 1;
                const half = item.size * 0.5;
                const box = { x: item.x - half, y: item.y - half, width: half * 2, height: half * 2 };
                expect(overlaps(box, input().bounds)).toBe(false);
            });
        }
        expect(checked).toBeGreaterThan(30);
    });

    it('keeps stickers and burst icons inside the screen', () => {
        const screen = input().screen;
        for (let k = 0; k < 30; k += 1) {
            planShotCollage(input({ seed: `inside${k}`, family: 'botan' })).items.forEach(item => {
                if (item.kind !== 'sticker' && item.kind !== 'pop') return;
                expect(item.x).toBeGreaterThanOrEqual(screen.x);
                expect(item.x).toBeLessThanOrEqual(screen.x + screen.width);
                expect(item.y).toBeGreaterThanOrEqual(screen.y);
                expect(item.y).toBeLessThanOrEqual(screen.y + screen.height);
            });
        }
    });

    it('crosses strips shots with two different decorative strips and no text', () => {
        let checked = 0;
        for (let k = 0; k < 40; k += 1) {
            const plan = planShotCollage(input({ seed: `strips${k}`, family: 'obi', previous: 'scrapbook' }));
            if (plan.recipe !== 'strips') continue;
            const strips = plan.items.filter(item => item.kind === 'strip');
            expect(strips).toHaveLength(2);
            expect(new Set(strips.map(item => item.kind === 'strip' && item.style)).size).toBe(2);
            strips.forEach(item => expect(item).not.toHaveProperty('text'));
            checked += 1;
        }
        expect(checked).toBeGreaterThan(5);
    });

    it('fills bridge shots with a film strip and rising sticker balloons', () => {
        const plan = planShotCollage(input({ isBridge: true, start: 0, end: 7 }));
        expect(plan.recipe).toBe('bridge');
        expect(plan.items.some(item => item.kind === 'strip' && item.style === 'film')).toBe(true);
        const floaters = plan.items.filter(item => item.kind === 'floater');
        expect(floaters.length).toBeGreaterThanOrEqual(3);
        floaters.forEach(item => {
            if (item.kind === 'floater') expect(item.rise).toBeGreaterThan(input().screen.height);
        });
    });

    it('puts the now-playing card on the opening bridge and keeps burst icons away from it', () => {
        const plan = planShotCollage(input({ isBridge: true, start: 0, end: 6, opening: { title: 'Lantern Tide', artist: 'Probe Ensemble' } }));
        expect(plan.recipe).toBe('opening');
        expect(plan.items.some(item => item.kind === 'headline' && item.text === 'Lantern Tide')).toBe(true);
        expect(plan.items.some(item => item.kind === 'label' && item.text === 'Probe Ensemble')).toBe(true);
        expect(plan.items.some(item => item.kind === 'pop')).toBe(false);
    });

    it('scales the sticker count with the amount', () => {
        const count = (amount: number) => planShotCollage(input({ family: 'botan', seed: 'bomb', amount, previous: 'scrapbook' }))
            .items.filter(item => item.kind === 'sticker').length;
        expect(count(2)).toBeGreaterThan(count(0.5));
    });
});

describe('burst icons', () => {
    it('uses the theme icons in turn and the flower without any', () => {
        const used = new Set<string>();
        for (let k = 0; k < 30; k += 1) {
            planShotCollage(input({ seed: `icons${k}`, isBridge: true, icons: ['Moon', 'Star'], bursts: [0, 1, 2, 3].map(n => ({ x: -300 + n * 200, y: -200, at: 1 + n, kind: 'kiku' as const, main: true, radius: 150 })) }))
                .items.forEach(item => {
                    if (item.kind === 'pop' || item.kind === 'whoosh') used.add(item.icon);
                });
        }
        expect([...used].sort()).toEqual(['Moon', 'Star']);
        const fallback = planShotCollage(input({ seed: 'fallback', icons: [] })).items
            .filter(item => item.kind === 'pop' || item.kind === 'whoosh')
            .map(item => (item.kind === 'pop' || item.kind === 'whoosh' ? item.icon : ''));
        fallback.forEach(icon => expect(icon).toBe('Flower'));
    });
});

describe('chooseCollageRecipe', () => {
    it('always uses the bridge recipe for bridge shots', () => {
        expect(chooseCollageRecipe('kiku', true, null, () => 0.3)).toBe('bridge');
    });

    it('falls back to a generic set for unknown families', () => {
        expect(['scrapbook', 'strips', 'stickerbomb']).toContain(chooseCollageRecipe('unknown', false, null, () => 0.99));
    });
});

describe('pickCollageKeyword', () => {
    const line = (fullText: string): Line => ({ fullText, words: [{ text: fullText, startTime: 0, endTime: 1 }], startTime: 0, endTime: 1 });

    it('uses a short line whole', () => {
        expect(pickCollageKeyword(line('晚安'))).toBe('晚安');
    });

    it('shouts latin words', () => {
        expect(pickCollageKeyword(line('hold on to the midnight river'))).toBe('MIDNIGHT');
    });

    it('returns null without a line', () => {
        expect(pickCollageKeyword(null)).toBeNull();
    });
});

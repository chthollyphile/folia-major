import { describe, expect, it } from 'vitest';
import {
    createMachiEnvironmentState,
    MACHI_DAYLIGHT,
    resolveMachiDaylight,
    resolveMachiDaylightAt,
    resolveMachiEnvironmentLook,
    resolveMachiEnvironmentTarget,
    resolveMachiWeatherKind,
    stepMachiEnvironment,
    type MachiEnvironmentState,
    type MachiEnvironmentTarget,
} from '@/components/visualizer/machi/engine/environment';

// test/unit/visualizer/machi/environment.test.ts
// 町景的时间与天气：自动时间按本地时钟分白天、黄昏、夜；自动天气按 seed 确定、大致按权重分布；
// 换天气时降水追得快、路面的湿和积雪追得慢；推出来的灯光标量白天、夜里各是该有的样子。

describe('daylight', () => {
    it('follows the local clock when automatic', () => {
        expect(resolveMachiDaylightAt(12)).toBe(1);
        expect(resolveMachiDaylightAt(0)).toBe(0);
        expect(resolveMachiDaylightAt(22)).toBe(0);
        expect(resolveMachiDaylightAt(17.5)).toBeCloseTo(MACHI_DAYLIGHT.dusk);
        expect(resolveMachiDaylightAt(17)).toBeGreaterThan(MACHI_DAYLIGHT.dusk);
        expect(resolveMachiDaylightAt(18)).toBeLessThan(MACHI_DAYLIGHT.dusk);
        expect(resolveMachiDaylightAt(5.75)).toBeGreaterThan(0);
        expect(resolveMachiDaylightAt(5.75)).toBeLessThan(1);
        expect(resolveMachiDaylight('auto', new Date(2026, 9, 27, 13, 0))).toBe(1);
    });

    it('falls monotonically through the evening', () => {
        let previous = 1;
        for (let hour = 16; hour <= 19; hour += 0.1) {
            const value = resolveMachiDaylightAt(hour);
            expect(value).toBeLessThanOrEqual(previous + 1e-9);
            previous = value;
        }
    });

    it('uses the fixed presets when chosen', () => {
        const noon = new Date(2026, 9, 27, 12);
        expect(resolveMachiDaylight('night', noon)).toBe(0);
        expect(resolveMachiDaylight('dusk', noon)).toBe(MACHI_DAYLIGHT.dusk);
        expect(resolveMachiDaylight('day', new Date(2026, 9, 27, 23))).toBe(1);
    });
});

describe('weather', () => {
    it('keeps a chosen weather and picks a stable one per song when automatic', () => {
        expect(resolveMachiWeatherKind('snow', 'x')).toBe('snow');
        ['a', 'b', 42].forEach(seed => expect(resolveMachiWeatherKind('auto', seed)).toBe(resolveMachiWeatherKind('auto', seed)));
    });

    it('spreads automatic weather roughly by its weights', () => {
        const counts: Record<string, number> = { rain: 0, clear: 0, fog: 0, snow: 0 };
        for (let index = 0; index < 4000; index += 1) counts[resolveMachiWeatherKind('auto', `song-${index}`)]! += 1;
        expect(counts.rain! / 4000).toBeCloseTo(0.35, 1);
        expect(counts.clear! / 4000).toBeCloseTo(0.3, 1);
        expect(counts.fog! / 4000).toBeCloseTo(0.2, 1);
        expect(counts.snow! / 4000).toBeCloseTo(0.15, 1);
    });
});

describe('transitions', () => {
    const run = (state: MachiEnvironmentState, target: MachiEnvironmentTarget, seconds: number) => {
        let next = state;
        for (let t = 0; t < seconds; t += 0.05) next = stepMachiEnvironment(next, target, 0.05);
        return next;
    };

    it('stops the rain quickly but dries the road slowly', () => {
        const rainy = createMachiEnvironmentState(resolveMachiEnvironmentTarget(0, 'rain'));
        const clear = resolveMachiEnvironmentTarget(0, 'clear');
        const soon = run(rainy, clear, 6);
        expect(soon.rain).toBeLessThan(0.05);
        expect(soon.wetness).toBeGreaterThan(0.6);
        expect(run(rainy, clear, 200).wetness).toBe(0);
    });

    it('lets snow settle slower than it falls and melt away afterwards', () => {
        const clear = createMachiEnvironmentState(resolveMachiEnvironmentTarget(1, 'clear'));
        const snowy = resolveMachiEnvironmentTarget(1, 'snow');
        const soon = run(clear, snowy, 4);
        expect(soon.snow).toBeGreaterThan(soon.snowCover);
        const settled = run(clear, snowy, 120);
        expect(settled.snowCover).toBe(1);
        expect(run(settled, resolveMachiEnvironmentTarget(1, 'clear'), 200).snowCover).toBe(0);
    });

    it('moves the sun towards the new time of day and stops there', () => {
        const night = createMachiEnvironmentState(resolveMachiEnvironmentTarget(0, 'clear'));
        const day = resolveMachiEnvironmentTarget(1, 'clear');
        expect(run(night, day, 1).daylight).toBeGreaterThan(0);
        expect(run(night, day, 1).daylight).toBeLessThan(1);
        expect(run(night, day, 30).daylight).toBe(1);
    });
});

describe('look', () => {
    it('switches the street lamps off by day and on by night', () => {
        const day = resolveMachiEnvironmentLook(createMachiEnvironmentState(resolveMachiEnvironmentTarget(1, 'clear')));
        const night = resolveMachiEnvironmentLook(createMachiEnvironmentState(resolveMachiEnvironmentTarget(0, 'clear')));
        expect(day.streetLamps).toBe(0);
        expect(night.streetLamps).toBe(1);
        expect(day.artificial).toBeLessThan(night.artificial);
        expect(day.sunIntensity).toBeGreaterThan(night.sunIntensity);
        expect(day.bloom).toBeLessThan(night.bloom);
    });

    it('shows stars only on clear nights and greys the sky when it rains', () => {
        const clearNight = resolveMachiEnvironmentLook(createMachiEnvironmentState(resolveMachiEnvironmentTarget(0, 'clear')));
        const rainyNight = resolveMachiEnvironmentLook(createMachiEnvironmentState(resolveMachiEnvironmentTarget(0, 'rain')));
        const fogDay = resolveMachiEnvironmentLook(createMachiEnvironmentState(resolveMachiEnvironmentTarget(1, 'fog')));
        expect(clearNight.stars).toBe(1);
        expect(rainyNight.stars).toBe(0);
        expect(rainyNight.overcast).toBe(1);
        expect(fogDay.haze).toBeGreaterThan(0.3);
        expect(clearNight.haze).toBe(0);
    });
});

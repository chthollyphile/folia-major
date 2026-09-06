import { beforeEach, describe, expect, it } from 'vitest';

// test/unit/liquidGlassTuningStore.test.ts
// 播放页胶囊液态玻璃调参 store 的钳制与重置逻辑。node 环境无 localStorage，
// 持久化分支自然被跳过，只验证纯状态行为。

const {
    DEFAULT_LIQUID_GLASS_TUNING,
    LIQUID_GLASS_SURFACE_DISPERSION_OVERRIDE,
    LIQUID_GLASS_SURFACE_TINT_PRESETS,
    resolveLiquidGlassTintMultiplier,
    resolveSurfaceDispersion,
    useLiquidGlassTuningStore,
} = await import('../../src/stores/useLiquidGlassTuningStore');

describe('useLiquidGlassTuningStore', () => {
    beforeEach(() => {
        useLiquidGlassTuningStore.getState().handleResetLiquidGlassTuning();
    });

    it('初始值等于默认调参', () => {
        expect(useLiquidGlassTuningStore.getState().liquidGlassTuning)
            .toEqual(DEFAULT_LIQUID_GLASS_TUNING);
    });

    it('handleSetLiquidGlassTuning 接受范围内的更新', () => {
        useLiquidGlassTuningStore.getState().handleSetLiquidGlassTuning({
            edgeDisplacement: 18,
            blur: 4.5,
            saturation: 2,
            darkTint: 0.3,
            lightTint: 0.75,
        });
        expect(useLiquidGlassTuningStore.getState().liquidGlassTuning)
            .toEqual({ edgeDisplacement: 18, blur: 4.5, saturation: 2, rimIntensity: DEFAULT_LIQUID_GLASS_TUNING.rimIntensity, darkTint: 0.3, lightTint: 0.75, dispersion: DEFAULT_LIQUID_GLASS_TUNING.dispersion, dispersionStrength: DEFAULT_LIQUID_GLASS_TUNING.dispersionStrength, enabled: true });
    });

    it('越界值被钳制到滑杆范围', () => {
        useLiquidGlassTuningStore.getState().handleSetLiquidGlassTuning({
            edgeDisplacement: 999,
            blur: -5,
            saturation: 42,
            darkTint: -1,
            lightTint: 99,
        });
        expect(useLiquidGlassTuningStore.getState().liquidGlassTuning)
            .toEqual({ edgeDisplacement: 50, blur: 0, saturation: 2, rimIntensity: DEFAULT_LIQUID_GLASS_TUNING.rimIntensity, darkTint: 0, lightTint: 1, dispersion: DEFAULT_LIQUID_GLASS_TUNING.dispersion, dispersionStrength: DEFAULT_LIQUID_GLASS_TUNING.dispersionStrength, enabled: true });
    });

    it('合法零值不被默认值吞掉', () => {
        useLiquidGlassTuningStore.getState().handleSetLiquidGlassTuning({
            blur: 0,
            edgeDisplacement: 0,
            darkTint: 0,
            lightTint: 0,
        });
        expect(useLiquidGlassTuningStore.getState().liquidGlassTuning)
            .toEqual({ edgeDisplacement: 0, blur: 0, saturation: 1.6, rimIntensity: DEFAULT_LIQUID_GLASS_TUNING.rimIntensity, darkTint: 0, lightTint: 0, dispersion: DEFAULT_LIQUID_GLASS_TUNING.dispersion, dispersionStrength: DEFAULT_LIQUID_GLASS_TUNING.dispersionStrength, enabled: true });
    });

    it('rimIntensity 接受 0（关闭高光）且越界被钳制', () => {
        useLiquidGlassTuningStore.getState().handleSetLiquidGlassTuning({ rimIntensity: 0 });
        expect(useLiquidGlassTuningStore.getState().liquidGlassTuning.rimIntensity).toBe(0);
        useLiquidGlassTuningStore.getState().handleSetLiquidGlassTuning({ rimIntensity: 99 });
        expect(useLiquidGlassTuningStore.getState().liquidGlassTuning.rimIntensity).toBe(0.05);
        useLiquidGlassTuningStore.getState().handleSetLiquidGlassTuning({ rimIntensity: Number.NaN });
        expect(useLiquidGlassTuningStore.getState().liquidGlassTuning.rimIntensity)
            .toBe(DEFAULT_LIQUID_GLASS_TUNING.rimIntensity);
    });

    it('dispersion 默认关闭，只认显式 true 开启', () => {
        useLiquidGlassTuningStore.getState().handleSetLiquidGlassTuning({ dispersion: true });
        expect(useLiquidGlassTuningStore.getState().liquidGlassTuning.dispersion).toBe(true);
        // 真值非法值与缺省都保持默认关闭
        useLiquidGlassTuningStore.getState().handleSetLiquidGlassTuning({ dispersion: 'yes' as unknown as boolean });
        expect(useLiquidGlassTuningStore.getState().liquidGlassTuning.dispersion).toBe(false);
        useLiquidGlassTuningStore.getState().handleSetLiquidGlassTuning({});
        expect(useLiquidGlassTuningStore.getState().liquidGlassTuning.dispersion).toBe(false);
    });

    it('dispersionStrength 接受 0（等价关闭）且越界被钳制', () => {
        useLiquidGlassTuningStore.getState().handleSetLiquidGlassTuning({ dispersionStrength: 0 });
        expect(useLiquidGlassTuningStore.getState().liquidGlassTuning.dispersionStrength).toBe(0);
        useLiquidGlassTuningStore.getState().handleSetLiquidGlassTuning({ dispersionStrength: 99 });
        expect(useLiquidGlassTuningStore.getState().liquidGlassTuning.dispersionStrength).toBe(2);
        useLiquidGlassTuningStore.getState().handleSetLiquidGlassTuning({ dispersionStrength: Number.NaN });
        expect(useLiquidGlassTuningStore.getState().liquidGlassTuning.dispersionStrength)
            .toBe(DEFAULT_LIQUID_GLASS_TUNING.dispersionStrength);
    });

    it('enabled 总开关只认显式 false，非法值保持开启', () => {
        useLiquidGlassTuningStore.getState().handleSetLiquidGlassTuning({ enabled: false });
        expect(useLiquidGlassTuningStore.getState().liquidGlassTuning.enabled).toBe(false);
        useLiquidGlassTuningStore.getState().handleSetLiquidGlassTuning({ enabled: 'no' as unknown as boolean });
        expect(useLiquidGlassTuningStore.getState().liquidGlassTuning.enabled).toBe(true);
        useLiquidGlassTuningStore.getState().handleSetLiquidGlassTuning({ enabled: false, dispersion: false });
        useLiquidGlassTuningStore.getState().handleResetLiquidGlassTuning();
        expect(useLiquidGlassTuningStore.getState().liquidGlassTuning.enabled).toBe(true);
        expect(useLiquidGlassTuningStore.getState().liquidGlassTuning.dispersion).toBe(false);
    });

    it('NaN 输入回退默认值而不是产生 NaN', () => {
        useLiquidGlassTuningStore.getState().handleSetLiquidGlassTuning({
            edgeDisplacement: Number.NaN,
        });
        expect(useLiquidGlassTuningStore.getState().liquidGlassTuning.edgeDisplacement)
            .toBe(DEFAULT_LIQUID_GLASS_TUNING.edgeDisplacement);
    });

    it('handleResetLiquidGlassTuning 恢复默认', () => {
        useLiquidGlassTuningStore.getState().handleSetLiquidGlassTuning({ blur: 20 });
        useLiquidGlassTuningStore.getState().handleResetLiquidGlassTuning();
        expect(useLiquidGlassTuningStore.getState().liquidGlassTuning)
            .toEqual(DEFAULT_LIQUID_GLASS_TUNING);
    });

    it('表面 tint 倍率按主题查预设并乘上状态倍率', () => {
        for (const surface of Object.keys(LIQUID_GLASS_SURFACE_TINT_PRESETS) as Array<keyof typeof LIQUID_GLASS_SURFACE_TINT_PRESETS>) {
            const preset = LIQUID_GLASS_SURFACE_TINT_PRESETS[surface];
            expect(resolveLiquidGlassTintMultiplier(surface, false))
                .toBeCloseTo(preset.dark);
            expect(resolveLiquidGlassTintMultiplier(surface, true))
                .toBeCloseTo(preset.light);
            expect(resolveLiquidGlassTintMultiplier(surface, false, 2))
                .toBeCloseTo(preset.dark * 2);
        }
    });

    it('表面色散覆盖优先于全局开关', () => {
        // 覆盖表里的表面强制 false，其余跟随全局
        expect(resolveSurfaceDispersion('lyricsTimeline', true)).toBe(false);
        expect(resolveSurfaceDispersion('lyricsTimeline', false)).toBe(false);
        expect(resolveSurfaceDispersion('playerPill', true)).toBe(true);
        expect(resolveSurfaceDispersion('playerPill', false)).toBe(false);
        // 覆盖表中的每一项都必须是显式 false（这张表只用于禁用）
        for (const overridden of Object.values(LIQUID_GLASS_SURFACE_DISPERSION_OVERRIDE)) {
            expect(overridden).toBe(false);
        }
    });
});

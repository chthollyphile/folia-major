import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import ConfirmDialog from '../../../shared/ConfirmDialog';
import { MOTION_SURFACE_IDS, useMotionSettingsStore, type MotionSurfaceId } from '../../../../stores/useMotionSettingsStore';
import { useDesktopSettingsStore } from '../../../../stores/useDesktopSettingsStore';
import { usePlayerChromeSettingsStore } from '../../../../stores/usePlayerChromeSettingsStore';
import { useThemeSettingsStore } from '../../../../stores/useThemeSettingsStore';
import { useVisualizerSettingsStore } from '../../../../stores/useVisualizerSettingsStore';
import type { LyricAntialias } from '../../../../types';
import { VISUALIZER_FRAME_RATE_OPTIONS } from '../../../../utils/frameRateLimiter';
import { LYRIC_RENDER_SCALES } from '../../../../utils/lyricRenderQuality';
import { lyricAntialiasChoices, lyricRenderScaleChoices } from '../../../visualizer/renderQuality/LyricRenderQualityRows';
import { Group, Link, Reveal, Row, Segmented, Toggle, option, useSettingsKitTheme, type SettingsGroupDef, type SettingsOptionDef } from '../kit';
import { GpuPreferenceRow } from './graphics/GpuPreferenceRow';
import { useSettingsPage } from './settingsPageContext';

// src/components/modal/settings/pages/GraphicsPage.tsx
// The 性能与动效 page: what trades picture for smoothness or works around a renderer problem
// (static mode, the home background, native blur, the frame-rate cap, the lyric canvas resolution and
// anti-aliasing every canvas / WebGL lyric style follows by default, background throttling, the
// Linux glow fix, the Windows render GPU), and which parts of the interface play reduced motion.

/** Docs page behind the "Fix lyric animation freeze on Linux" switch. */
const CHROMIUM_FD_EXHAUSTION_DOCS_URL = 'https://folia-site.cielaniska.top/guide/chromium-fd-exhaustion';

/** The rate the frame-rate cap starts at when it is switched on. */
const FRAME_RATE_WHEN_SWITCHED_ON = 120;

/** Native blur is not offered on Linux. */
const IS_LINUX = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('linux');

/** The render GPU choice only does something in the Windows desktop app (electron/gpuPreference.cjs). */
const IS_WINDOWS_DESKTOP = typeof window !== 'undefined' && window.electron?.platform === 'win32';

const PERFORMANCE: SettingsGroupDef = { id: 'graphicsPerformance', titleKey: 'options.labPerformanceSection' };
const MOTION: SettingsGroupDef = { id: 'graphicsMotion', titleKey: 'options.reduceMotionSection' };

const O = {
    staticMode: option(PERFORMANCE, 'enableStaticMode', 'options.enableStaticMode'),
    homeBackground: option(PERFORMANCE, 'disableHomeDynamicBackground', 'options.disableHomeDynamicBackground'),
    nativeBlur: option(PERFORMANCE, 'enablePlayerPageNativeBlur', 'options.enablePlayerPageNativeBlur'),
    frameRate: option(PERFORMANCE, 'visualizerFrameRate', 'options.visualizerFrameRate'),
    frameRateValue: option(PERFORMANCE, 'visualizerFrameRateValue', 'options.visualizerFrameRateValue'),
    lyricRenderScale: option(PERFORMANCE, 'lyricRenderScale', 'options.lyricRenderScale'),
    lyricAntialias: option(PERFORMANCE, 'lyricAntialias', 'options.lyricAntialias'),
    backgroundThrottling: option(PERFORMANCE, 'backgroundThrottling', 'options.backgroundThrottling', { electronOnly: true }),
    glowFix: option(PERFORMANCE, 'glowBlurQuantize', 'options.glowBlurQuantize'),
    gpuPreference: option(PERFORMANCE, 'gpuPreference', 'options.gpuPreference', { electronOnly: true, available: () => IS_WINDOWS_DESKTOP }),
    followSystem: option(MOTION, 'reduceMotionFollowSystem', 'options.reduceMotionFollowSystem'),
};

/** One row per part of the interface whose motion can be reduced, in the store's order. */
const SURFACE_ROWS: Record<MotionSurfaceId, { option: SettingsOptionDef; hintKey: string }> = {
    lattice: { option: option(MOTION, 'reduceMotionLattice', 'options.reduceMotionLattice'), hintKey: 'options.reduceMotionLatticeDesc' },
    transitionOverlay: { option: option(MOTION, 'reduceMotionTransitionOverlay', 'options.reduceMotionTransitionOverlay'), hintKey: 'options.reduceMotionTransitionOverlayDesc' },
    collectionMorph: { option: option(MOTION, 'reduceMotionCollectionMorph', 'options.reduceMotionCollectionMorph'), hintKey: 'options.reduceMotionCollectionMorphDesc' },
    monetBackground: { option: option(MOTION, 'reduceMotionMonetBackground', 'options.reduceMotionMonetBackground'), hintKey: 'options.reduceMotionMonetBackgroundDesc' },
    uiMicroMotion: { option: option(MOTION, 'reduceMotionUiMicroMotion', 'options.reduceMotionUiMicroMotion'), hintKey: 'options.reduceMotionUiMicroMotionDesc' },
    settingsScroll: { option: option(MOTION, 'reduceMotionSettingsScroll', 'options.reduceMotionSettingsScroll'), hintKey: 'options.reduceMotionSettingsScrollDesc' },
};

export const OPTIONS: SettingsOptionDef[] = [
    ...Object.values(O).filter(row => row !== O.nativeBlur || !IS_LINUX),
    ...MOTION_SURFACE_IDS.map(surface => SURFACE_ROWS[surface].option),
];

const FRAME_RATE_CHOICES = VISUALIZER_FRAME_RATE_OPTIONS.map(rate => ({ value: String(rate), label: `${rate} FPS` }));

const GraphicsPage: React.FC = () => {
    const { t } = useTranslation();
    const { isDaylight } = useSettingsKitTheme();
    const { isElectron } = useSettingsPage();
    const theme = useThemeSettingsStore(useShallow(state => ({
        staticMode: state.staticMode,
        homeBackgroundOff: state.disableHomeDynamicBackground,
        setStaticMode: state.handleToggleStaticMode,
        setHomeBackgroundOff: state.handleToggleDisableHomeDynamicBackground,
    })));
    const nativeBlur = usePlayerChromeSettingsStore(state => state.enablePlayerPageNativeBlur);
    const setNativeBlur = usePlayerChromeSettingsStore(state => state.handleTogglePlayerPageNativeBlur);
    const backgroundThrottling = useDesktopSettingsStore(state => state.backgroundThrottling);
    const setBackgroundThrottling = useDesktopSettingsStore(state => state.handleToggleBackgroundThrottling);
    const visualizer = useVisualizerSettingsStore(useShallow(state => ({
        frameRate: state.visualizerFrameRate,
        glowFix: state.glowBlurQuantize,
        setFrameRate: state.handleSetVisualizerFrameRate,
        setGlowFix: state.handleToggleGlowBlurQuantize,
        renderQuality: state.lyricRenderQuality,
        setRenderQuality: state.handleSetLyricRenderQuality,
    })));
    const motion = useMotionSettingsStore(useShallow(state => ({
        surfaces: state.reducedMotionSurfaces,
        followSystem: state.followSystemReducedMotion,
        systemPrefers: state.systemPrefersReducedMotion,
        setSurface: state.handleToggleReducedMotionSurface,
        setFollowSystem: state.handleToggleFollowSystemReducedMotion,
    })));
    // Native blur can drop frames on some GPUs, so switching it on asks first.
    const [nativeBlurAsking, setNativeBlurAsking] = useState(false);
    const frameRateLimited = visualizer.frameRate !== 'off';

    return (
        <>
            <Group def={PERFORMANCE}>
                <Row option={O.staticMode} hint={t('options.enableStaticModeDesc')}>
                    <Toggle checked={theme.staticMode} onChange={theme.setStaticMode} />
                </Row>
                <Row option={O.homeBackground} hint={t('options.disableHomeDynamicBackgroundDesc')}>
                    <Toggle checked={theme.homeBackgroundOff} onChange={theme.setHomeBackgroundOff} />
                </Row>
                {!IS_LINUX && (
                    <Row option={O.nativeBlur} hint={t('options.enablePlayerPageNativeBlurHint')} note={t('options.enablePlayerPageNativeBlurDesc')}>
                        <Toggle checked={nativeBlur} onChange={enabled => (enabled ? setNativeBlurAsking(true) : setNativeBlur(false))} />
                    </Row>
                )}
                <Row option={O.frameRate} hint={t('options.visualizerFrameRateDesc')}>
                    <Toggle
                        checked={frameRateLimited}
                        onChange={enabled => visualizer.setFrameRate(enabled ? FRAME_RATE_WHEN_SWITCHED_ON : 'off')}
                    />
                </Row>
                <Reveal when={frameRateLimited}>
                    <Row sub option={O.frameRateValue}>
                        <Segmented
                            value={String(visualizer.frameRate)}
                            options={FRAME_RATE_CHOICES}
                            onChange={(value) => {
                                const rate = VISUALIZER_FRAME_RATE_OPTIONS.find(candidate => String(candidate) === value);
                                if (rate) visualizer.setFrameRate(rate);
                            }}
                        />
                    </Row>
                </Reveal>
                <Row option={O.lyricRenderScale} note={t('options.lyricRenderScaleDesc')}>
                    <Segmented
                        value={String(visualizer.renderQuality.scale)}
                        options={lyricRenderScaleChoices()}
                        onChange={(value) => {
                            const scale = LYRIC_RENDER_SCALES.find(candidate => String(candidate) === value);
                            if (scale) visualizer.setRenderQuality({ scale });
                        }}
                    />
                </Row>
                <Row option={O.lyricAntialias} note={t('options.lyricAntialiasDesc')}>
                    <Segmented<LyricAntialias>
                        value={visualizer.renderQuality.antialias}
                        options={lyricAntialiasChoices(t)}
                        onChange={antialias => visualizer.setRenderQuality({ antialias })}
                    />
                </Row>
                {isElectron && (
                    <Row option={O.backgroundThrottling} hint={t('options.backgroundThrottlingHint')} note={t('options.backgroundThrottlingDesc')}>
                        <Toggle checked={backgroundThrottling} onChange={setBackgroundThrottling} />
                    </Row>
                )}
                <Row
                    option={O.glowFix}
                    hint={(
                        <>
                            {t('options.glowBlurQuantizeDesc')}{' '}
                            <Link href={CHROMIUM_FD_EXHAUSTION_DOCS_URL}>{t('options.glowBlurQuantizeDocs')}</Link>
                        </>
                    )}
                >
                    <Toggle checked={visualizer.glowFix} onChange={visualizer.setGlowFix} />
                </Row>
                {IS_WINDOWS_DESKTOP && <GpuPreferenceRow option={O.gpuPreference} />}
            </Group>

            <Group def={MOTION} foot={t('options.reduceMotionSectionDesc')}>
                <Row option={O.followSystem} hint={t('options.reduceMotionFollowSystemDesc')}>
                    <Toggle checked={motion.followSystem} onChange={motion.setFollowSystem} />
                </Row>
                {/* While the system asks for reduced motion and is followed, every row below is reduced whatever its switch says. */}
                <Reveal when={motion.followSystem && motion.systemPrefers}>
                    <Row sub notice={t('options.reduceMotionForcedNotice')} />
                </Reveal>
                {MOTION_SURFACE_IDS.map(surface => (
                    <Row key={surface} option={SURFACE_ROWS[surface].option} hint={t(SURFACE_ROWS[surface].hintKey)}>
                        <Toggle checked={motion.surfaces[surface]} onChange={enabled => motion.setSurface(surface, enabled)} />
                    </Row>
                ))}
            </Group>

            <ConfirmDialog
                isOpen={nativeBlurAsking}
                isDaylight={isDaylight}
                title={t('options.nativeBlurConfirmTitle')}
                description={t('options.nativeBlurConfirmDesc')}
                confirmText={t('options.nativeBlurConfirmAction')}
                onConfirm={() => {
                    setNativeBlur(true);
                    setNativeBlurAsking(false);
                }}
                onClose={() => setNativeBlurAsking(false)}
            />
        </>
    );
};

export default GraphicsPage;

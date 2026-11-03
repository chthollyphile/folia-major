import React from 'react';
import { Aperture, Cone } from 'lucide-react';
import { defineVisualizerBackground } from '../definition';
import { QuickControlToggle } from '../../../shared/QuickControlChip';
import CommonBackgroundSettingsCard from './CommonBackgroundSettingsCard';
import FluidBackground from './FluidBackground';
import GeometricBackground from './GeometricBackground';

// src/components/visualizer/backgrounds/common/entry.tsx
// Registers the built-in cover-color and geometric shell background.

export default defineVisualizerBackground({
    mode: 'common',
    order: 10,
    labelKey: 'options.visualizerBackgroundModeCommon',
    labelFallback: 'Common',
    // 通用：几何图形氛围层
    glyph: (
        <>
            <path d="M4 17l5-8 5 8z" />
            <circle cx="17.5" cy="8.5" r="3" opacity="0.55" />
        </>
    ),
    command: {
        title: 'Background: Common',
        description: 'Switch background to general layout',
        keywords: ['background general', 'common', 'general', '通用背景', 'ty', '背景切换到 通用', '背景切换到通用'],
    },
    // The geometry is laid out from the seed, and the cover colour layer draws the cover. The theme
    // colours change in place: the base colour glides, as it did.
    song: ({ config, coverUrl, seed, staticMode }) => [
        staticMode ? null : seed ?? null,
        config?.common?.useCoverColorBg ? coverUrl ?? null : null,
    ],
    render: ({
        config,
        theme,
        coverUrl,
        audioPower,
        audioBands,
        seed,
        staticMode,
        paused,
    }) => {
        const common = config?.common;
        const useCoverColorBg = common?.useCoverColorBg ?? false;

        return (
            <>
                {/* Shown at once: turning the cover colours on or off is a change of `song`, played by the
                    background layer around it. */}
                {useCoverColorBg && (
                    <div className="absolute inset-0 z-0">
                        <FluidBackground coverUrl={coverUrl} theme={theme} />
                    </div>
                )}
                <div
                    className="absolute inset-0 z-0 transition-all duration-1000"
                    style={{
                        backgroundColor: theme.backgroundColor,
                        opacity: useCoverColorBg ? common?.opacity ?? 0.75 : 1,
                    }}
                />
                {!staticMode && (
                    <div className="absolute inset-0 z-0">
                        <GeometricBackground
                            theme={theme}
                            audioPower={audioPower}
                            audioBands={audioBands}
                            seed={seed}
                            hideShapes={common?.disableGeometricBackground ?? false}
                            disableVignette={common?.disableVignette ?? false}
                            paused={paused}
                        />
                    </div>
                )}
            </>
        );
    },
    renderSettingsPanel: props => <CommonBackgroundSettingsCard {...props} />,
    renderQuickControls: ({ config, actions, t }) => {
        const useCoverColorBg = config?.common?.useCoverColorBg ?? false;
        // The vignette is stored as its opposite (disableVignette): the switch is lit while it is drawn.
        const vignette = !(config?.common?.disableVignette ?? false);

        return (
            <>
                <QuickControlToggle
                    active={useCoverColorBg}
                    label={t(useCoverColorBg ? 'theme.addCoverColor' : 'theme.useDefaultColor')}
                    onToggle={() => actions?.common?.onCoverColorChange?.(!useCoverColorBg)}
                >
                    <Cone size={14} />
                </QuickControlToggle>
                <QuickControlToggle
                    active={vignette}
                    label={t('options.visualizerVignette')}
                    onToggle={() => actions?.common?.onDisableVignetteChange?.(vignette)}
                >
                    <Aperture size={14} />
                </QuickControlToggle>
            </>
        );
    },
    resetSettings: actions => {
        actions?.common?.onOpacityChange?.(0.75);
        actions?.common?.onCoverColorChange?.(false);
        actions?.common?.onDisableVignetteChange?.(false);
        actions?.common?.onDisableGeometricChange?.(false);
    },
});

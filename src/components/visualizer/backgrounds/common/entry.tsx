import React from 'react';
import { motion } from 'framer-motion';
import { defineVisualizerBackground } from '../definition';
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
                {useCoverColorBg && (
                    <motion.div
                        key="fluid-bg"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 1 }}
                        className="absolute inset-0 z-0"
                    >
                        <FluidBackground coverUrl={coverUrl} theme={theme} />
                    </motion.div>
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
    resetSettings: actions => {
        actions?.common?.onOpacityChange?.(0.75);
        actions?.common?.onCoverColorChange?.(false);
        actions?.common?.onDisableVignetteChange?.(false);
        actions?.common?.onDisableGeometricChange?.(false);
    },
});

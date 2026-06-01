import React from 'react';
import { AnimatePresence } from 'framer-motion';
import type { VisualizerSharedProps } from './definition';
import type { VisualizerBgNode, VisualizerComplexV1, VisualizerMainNode, VisualizerOverlayNode } from './complex';
import { getOrderedComplexNodes } from './complex';
import { resolveVisualizerNodeProps } from './complexRuntime';
import FluidBackground from './FluidBackground';
import GeometricBackground from './GeometricBackground';
import VisualizerRenderer from './VisualizerRenderer';
import VisualizerSubtitleOverlay from './VisualizerSubtitleOverlay';
import { useVisualizerRuntime } from './runtime';
import type { VisualizerMode } from '../../types';

// src/components/visualizer/VisualizerComplexRenderer.tsx
// Renders the persisted visualizer complex as layered background, main, and overlay nodes.
interface VisualizerComplexRendererProps extends VisualizerSharedProps {
    complex: VisualizerComplexV1;
    fallbackMode: VisualizerMode;
}

const renderBackgroundNode = (node: VisualizerBgNode, props: VisualizerSharedProps) => {
    const opacity = node.config.opacity ?? 1;
    if (node.kind === 'solidTheme') {
        return (
            <div
                key={node.id}
                className="absolute inset-0"
                style={{
                    backgroundColor: props.transparentBackground ? 'transparent' : props.theme.backgroundColor,
                    opacity: props.transparentBackground ? 0 : opacity,
                }}
            />
        );
    }

    if (node.kind === 'coverFluid') {
        return (
            <div key={node.id} className="absolute inset-0" style={{ opacity }}>
                <FluidBackground coverUrl={node.config.useCoverColor === false ? null : props.coverUrl} theme={props.theme} />
            </div>
        );
    }

    if (node.kind === 'geometric') {
        return (
            <div key={node.id} className="absolute inset-0" style={{ opacity }}>
                <GeometricBackground
                    theme={props.theme}
                    audioPower={props.audioPower}
                    audioBands={props.audioBands}
                    seed={props.seed}
                    hideShapes={Boolean(props.disableGeometricBackground || node.config.hideShapes)}
                    disableVignette
                    paused={props.paused}
                />
            </div>
        );
    }

    if (node.kind === 'vignette' && !props.disableVignette) {
        return (
            <div
                key={node.id}
                className="absolute inset-0 pointer-events-none"
                style={{
                    opacity,
                    background: 'radial-gradient(circle at 50% 42%, transparent 0%, transparent 48%, rgba(0,0,0,0.34) 100%)',
                }}
            />
        );
    }

    return null;
};

const renderMainNode = (node: VisualizerMainNode, props: VisualizerSharedProps) => (
    <div
        key={node.id}
        className="absolute inset-0"
        style={{
            opacity: node.config.opacity ?? 1,
            mixBlendMode: node.config.opacity && node.config.opacity < 1 ? 'screen' : undefined,
        }}
    >
        <VisualizerRenderer
            {...props}
            mode={node.config.mode}
            transparentBackground
            disableGeometricBackground
            disableVignette
            lyricsFontScale={node.config.lyricsFontScale ?? props.lyricsFontScale}
            cadenzaTuning={node.config.cadenzaTuning ?? props.cadenzaTuning}
            partitaTuning={node.config.partitaTuning ?? props.partitaTuning}
            fumeTuning={node.config.fumeTuning ?? props.fumeTuning}
            cappellaTuning={node.config.cappellaTuning ?? props.cappellaTuning}
            tiltTuning={node.config.tiltTuning ?? props.tiltTuning}
            hideTranslationSubtitle
            onBack={undefined}
        />
    </div>
);

const renderOverlayNode = (
    node: VisualizerOverlayNode,
    props: VisualizerSharedProps,
) => {
    if (node.kind !== 'subtitle') {
        return null;
    }

    return <VisualizerOverlayLayer key={node.id} node={node} props={props} />;
};

const VisualizerOverlayLayer = ({
    node,
    props,
}: {
    node: VisualizerOverlayNode;
    props: VisualizerSharedProps;
}) => {
    const runtime = useVisualizerRuntime({
        lines: props.lines,
        currentLineIndex: props.currentLineIndex,
        currentTime: props.currentTime,
    });

    return (
        <VisualizerSubtitleOverlay
            showText={Boolean(props.showText)}
            activeLine={runtime.activeLine}
            recentCompletedLine={runtime.recentCompletedLine}
            nextLines={runtime.nextLines}
            theme={props.theme}
            translationFontSize={`${node.config.translationFontSizeRem ?? 1.1}rem`}
            upcomingFontSize={`${node.config.upcomingFontSizeRem ?? 0.95}rem`}
            opacity={node.config.opacity ?? 0.6}
            isPlayerChromeHidden={props.isPlayerChromeHidden}
            hideTranslationSubtitle={Boolean(props.hideTranslationSubtitle || node.config.hideTranslation)}
        />
    );
};

const VisualizerComplexRenderer: React.FC<VisualizerComplexRendererProps> = ({ complex, fallbackMode, ...props }) => {
    const backgroundNodes = getOrderedComplexNodes(complex, 'visualizerBg', complex.output.bgNodeIds);
    const mainNodes = getOrderedComplexNodes(complex, 'visualizerMain', complex.output.mainNodeIds);
    const overlayNodes = getOrderedComplexNodes(complex, 'visualizerOverlay', complex.output.overlayNodeIds);

    return (
        <div
            className="w-full h-full overflow-hidden relative transition-colors duration-1000"
            style={{ backgroundColor: props.transparentBackground ? 'transparent' : props.theme.backgroundColor }}
        >
            <AnimatePresence>
                {backgroundNodes.map(node => renderBackgroundNode(node, resolveVisualizerNodeProps(complex, node, props)))}
            </AnimatePresence>

            {mainNodes.length > 0
                ? mainNodes.map(node => renderMainNode(node, resolveVisualizerNodeProps(complex, node, props)))
                : (
                    <VisualizerRenderer
                        {...props}
                        mode={fallbackMode}
                    />
                )}

            {overlayNodes.map(node => renderOverlayNode(node, resolveVisualizerNodeProps(complex, node, props)))}
        </div>
    );
};

export default VisualizerComplexRenderer;

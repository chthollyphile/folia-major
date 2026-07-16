import React from 'react';
import { ImageDithering } from '@paper-design/shaders-react';
import { DEFAULT_NOMAND_BACKGROUND_TUNING, type MonetBackgroundImage, type NomandBackgroundTuning, type Theme } from '../../../../types';

// src/components/visualizer/backgrounds/nomand/NomandBackgroundLayer.tsx
// Renders the Paper image-dithering shader with the current selected theme palette.

interface NomandBackgroundLayerProps {
    coverUrl?: string | null;
    monetBackgroundImage?: MonetBackgroundImage | null;
    tuning?: NomandBackgroundTuning;
    theme: Theme;
}

const NomandBackgroundLayer: React.FC<NomandBackgroundLayerProps> = ({
    coverUrl,
    monetBackgroundImage,
    tuning: tuningOverride,
    theme,
}) => {
    const tuning = tuningOverride ?? DEFAULT_NOMAND_BACKGROUND_TUNING;
    const sourceUrl = tuning.imageSource === 'uploaded-global'
        ? monetBackgroundImage?.url ?? coverUrl
        : coverUrl ?? monetBackgroundImage?.url;

    if (!sourceUrl) {
        return (
            <div
                className="absolute inset-0 z-0"
                style={{ backgroundColor: theme.backgroundColor }}
            />
        );
    }

    return (
        <div
            className="absolute inset-0 z-0 overflow-hidden"
            style={{ backgroundColor: theme.backgroundColor, pointerEvents: 'none' }}
        >
            <ImageDithering
                key={sourceUrl}
                width="100%"
                height="100%"
                image={sourceUrl}
                colorBack={theme.backgroundColor}
                colorFront={theme.accentColor}
                colorHighlight={theme.primaryColor}
                originalColors={tuning.originalColors}
                inverted={tuning.inverted}
                type={tuning.ditheringType}
                size={tuning.size}
                colorSteps={tuning.colorSteps}
                fit="cover"
                minPixelRatio={1}
                maxPixelCount={1920 * 1080}
                style={{ width: '100%', height: '100%' }}
            />
            {tuning.overlayEnabled && tuning.overlayOpacity > 0 && (
                <div
                    className="absolute inset-0"
                    style={{
                        backgroundColor: theme.backgroundColor,
                        opacity: tuning.overlayOpacity,
                    }}
                />
            )}
        </div>
    );
};

export default React.memo(NomandBackgroundLayer);

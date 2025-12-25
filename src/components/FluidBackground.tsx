import React, { memo } from 'react';
import { Theme } from '../types';

interface FluidBackgroundProps {
    coverUrl?: string | null;
    theme: Theme;
}

const FluidBackground: React.FC<FluidBackgroundProps> = memo(({ coverUrl, theme }) => {
    return (
        <div className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none z-0">
            {/* Background Image / Fallback */}
            {coverUrl ? (
                <div
                    className="absolute inset-0 w-full h-full bg-center bg-cover transition-all duration-1000 ease-in-out"
                    style={{
                        backgroundImage: `url(${coverUrl})`,
                        filter: 'blur(40px) brightness(1)',
                        transform: 'scale(1.5)',
                        opacity: 1
                    }}
                />
            ) : (
                <div
                    className="absolute inset-0 w-full h-full transition-colors duration-1000"
                    style={{
                        backgroundColor: theme.backgroundColor,
                        opacity: 0.8
                    }}
                />
            )}

            {/* Overlay Gradient for better text readability and blending */}
            <div
                className="absolute inset-0 w-full h-full opacity-40 mix-blend-overlay"
                style={{
                    background: `linear-gradient(to bottom right, ${theme.primaryColor}, transparent, ${theme.secondaryColor})`
                }}
            />
        </div>
    );
}, (prevProps, nextProps) => {
    // Custom comparison function for React.memo
    if (prevProps.coverUrl !== nextProps.coverUrl) return false;

    const pTheme = prevProps.theme;
    const nTheme = nextProps.theme;

    return (
        pTheme.backgroundColor === nTheme.backgroundColor &&
        pTheme.primaryColor === nTheme.primaryColor &&
        pTheme.secondaryColor === nTheme.secondaryColor
    );
});

export default FluidBackground;

import React, { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Theme } from '../../../../types';
import { getSizedCoverUrl } from '../../../../utils/coverUrl';

// src/components/visualizer/backgrounds/transparent/TransparentCoverBackground.tsx
// Cover-only shell background derived from Monet's full-overlay layout: the song cover fills the
// layer with no color wash and no blur, and nothing is drawn on top of it.

interface TransparentCoverBackgroundProps {
    coverUrl?: string | null;
    theme: Theme;
}

const COVER_RENDER_SIZE = 1024;

const TransparentCoverBackground: React.FC<TransparentCoverBackgroundProps> = ({ coverUrl, theme }) => {
    // Always the track artwork: this style intentionally ignores the Monet upload source.
    const sourceUrl = useMemo(
        () => (coverUrl ? getSizedCoverUrl(coverUrl, COVER_RENDER_SIZE) : null),
        [coverUrl],
    );

    return (
        <div className="absolute inset-0 z-0 overflow-hidden">
            <AnimatePresence initial={false}>
                {sourceUrl ? (
                    <motion.div
                        key={sourceUrl}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.8, ease: 'easeInOut' }}
                        className="absolute inset-0"
                        style={{
                            backgroundColor: theme.backgroundColor,
                            backgroundImage: `url(${sourceUrl})`,
                            backgroundRepeat: 'no-repeat',
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                        }}
                    />
                ) : (
                    <div
                        key="empty"
                        className="absolute inset-0"
                        style={{ backgroundColor: theme.backgroundColor }}
                    />
                )}
            </AnimatePresence>
        </div>
    );
};

export default TransparentCoverBackground;

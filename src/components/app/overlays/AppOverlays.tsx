import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import FloatingPlayerControls from '../../FloatingPlayerControls';
import SearchResultsOverlay from '../../SearchResultsOverlay';
import DevDebugOverlay from '../../DevDebugOverlay';
import PlaylistView from '../views/PlaylistView';
import AlbumView from '../views/AlbumView';
import ArtistView from '../views/ArtistView';
import type { AppOverlaysModel } from '../view-models/useAppOverlaysModel';

// Centralized app-level overlay renderer so App.tsx does not mount leaf overlays directly.
type AppOverlaysProps = {
    model: AppOverlaysModel;
};

const AppOverlays: React.FC<AppOverlaysProps> = ({ model }) => {
    const {
        homeOverlay,
        searchOverlay,
        detailOverlay,
        debugOverlay,
        floatingControls,
    } = model;

    return (
        <>
            <AnimatePresence>
                {homeOverlay?.isVisible && (
                    <motion.div
                        className="absolute inset-0 z-50"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.5, ease: 'easeInOut' }}
                    >
                        {homeOverlay.content}
                    </motion.div>
                )}
            </AnimatePresence>

            {searchOverlay && <SearchResultsOverlay {...searchOverlay} />}

            <AnimatePresence>
                {detailOverlay && (() => {
                    const { type, props } = detailOverlay;
                    if (type === 'playlist') {
                        return <PlaylistView {...props} />;
                    }
                    if (type === 'album') {
                        return <AlbumView {...props} />;
                    }
                    return <ArtistView {...props} />;
                })()}
            </AnimatePresence>

            {debugOverlay && <DevDebugOverlay {...debugOverlay} />}

            {floatingControls && <FloatingPlayerControls {...floatingControls} />}
        </>
    );
};

export default AppOverlays;

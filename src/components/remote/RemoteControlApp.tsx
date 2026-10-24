import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { PlayerState } from '../../types';
import { idleVideoExportState } from '../../types/videoExport';
import { useReducedMotionFor } from '../../hooks/useReducedMotionFor';
import { isRemoteExportBusy } from './RemoteExportTab';
import RemoteKeyRow from './RemoteKeyRow';
import RemoteLyricBlock from './RemoteLyricBlock';
import RemoteProgressLine from './RemoteProgressLine';
import RemoteSheet from './RemoteSheet';
import RemoteSongLine, { RemoteCoverFaces, RemoteOutgoingRecede } from './RemoteSongLine';
import RemoteWindowTools, { type RemoteBackgroundMode } from './RemoteWindowTools';
import {
    REMOTE_DRAG_STYLE,
    sendRemoteCommand,
    useLingering,
    useRemotePointerInside,
    useRemoteSnapshot,
    useRemoteWindowPresentation,
} from './remoteWindowBridge';
import { useRemoteClock } from './useRemoteClock';
import { useRemoteCoverArt } from './useRemoteCoverArt';
import { useRemoteExportChoices } from './useRemoteExportChoices';
import { useRemoteLyricLine } from './useRemoteLyricLine';
import { useRemoteSheet } from './useRemoteSheet';
import { useRemoteSleeve } from './useRemoteSleeve';
import { useRemoteTrackHandoff } from './useRemoteTrackHandoff';
import './remote.css';

// src/components/remote/RemoteControlApp.tsx
// Electron-only companion window for controlling the single real player instance.
// A block of type (the song, the line being sung, its translation), one line that is both the
// divider and the progress bar, and a row of keys. With the pointer in, it lights up what already
// has a place; a moment after the pointer leaves, the keys go and the line takes their place, and
// (with the switch "expand cover" on) the card turns into a sleeve: the cover large on the left,
// the song and the line on the right. This file holds the window's state and puts the parts together.

const REMOTE_CONTROL_DOCUMENT_TITLE = 'Folia Remote';
const REMOTE_BACKGROUND_MODE_STORAGE_KEY = 'remote_background_mode';
/** What the pointer lit stays lit this long after the pointer leaves. */
const LIT_LINGER_MS = 800;

const readStoredBackgroundMode = (): RemoteBackgroundMode => {
    if (typeof window !== 'undefined') {
        const stored = window.localStorage.getItem(REMOTE_BACKGROUND_MODE_STORAGE_KEY);
        if (stored === 'cover' || stored === 'transparent' || stored === 'default') {
            return stored;
        }
    }
    return 'default';
};

const RemoteControlApp: React.FC = () => {
    const { t } = useTranslation();
    const reduceMotion = useReducedMotionFor('uiMicroMotion');
    const snapshot = useRemoteSnapshot();
    const presentation = useRemoteWindowPresentation();
    const pointerInside = useRemotePointerInside(presentation.clickThrough);
    const pointerLingers = useLingering(pointerInside, LIT_LINGER_MS);
    const [hasKeyboardFocus, setHasKeyboardFocus] = useState(false);
    const [backgroundMode, setBackgroundMode] = useState<RemoteBackgroundMode>(readStoredBackgroundMode);
    const choices = useRemoteExportChoices();
    const cardRef = useRef<HTMLDivElement | null>(null);

    const isPlaying = snapshot.playerState === PlayerState.PLAYING;
    const duration = Number.isFinite(snapshot.duration) && snapshot.duration > 0 ? snapshot.duration : 0;
    const primaryDisabled = snapshot.controlsDisabled || !snapshot.hasTrack;
    const exportState = snapshot.exportState ?? idleVideoExportState();
    const exportBusy = isRemoteExportBusy(exportState.status);
    const title = snapshot.title || (snapshot.hasTrack ? 'Folia' : t('remote.noTrack'));
    const artist = snapshot.artist || (snapshot.hasTrack ? t('remote.unknownArtist') : '');

    const clock = useRemoteClock({
        updatedAt: snapshot.updatedAt,
        currentTime: snapshot.currentTime,
        duration,
        playerState: snapshot.playerState,
    });
    const lyricOffsetSec = (snapshot.lyricOffsetMs || 0) / 1000;
    const lyric = useRemoteLyricLine(snapshot.hasTrack ? snapshot.lyrics : null, clock, lyricOffsetSec);
    const handoff = useRemoteTrackHandoff({ snapshot, title, artist, isPlaying });
    // Past the audio crossover the outgoing song's line has receded: the stage turns to the incoming
    // song's title card there, inside the blend, rather than when the blend settles.
    const lyricGivesWay = handoff.isHandoffActive && handoff.isIncomingDominant;
    const shownLine = lyricGivesWay ? null : lyric.line;
    useRemoteCoverArt({
        prevTrackCoverUrl: snapshot.prevTrackCoverUrl,
        nextTrackCoverUrl: snapshot.nextTrackCoverUrl,
    });

    // A click-through window is a display: nothing lights up and nothing opens.
    const isDisplayOnly = presentation.clickThrough;
    const isLit = !isDisplayOnly && (pointerLingers || hasKeyboardFocus);
    const sheet = useRemoteSheet({
        exportStatus: exportState.status,
        isExportBusy: exportBusy,
        pointerInside,
        isDisplayOnly,
    });
    // An open sheet is the card in use too: it stands where the sleeve's song and line would be.
    const isIdle = useRemoteSleeve(!isLit && !sheet.isOpen, reduceMotion, cardRef);
    // Idle puts the line where the keys were; the switch "expand cover" decides whether it also opens the sleeve.
    const isSleeve = isIdle && presentation.expandCover;

    useEffect(() => {
        document.body.style.backgroundColor = 'transparent';
        document.documentElement.style.backgroundColor = 'transparent';
        document.body.style.overflow = 'visible';
        document.title = REMOTE_CONTROL_DOCUMENT_TITLE;
    }, []);

    useEffect(() => {
        window.localStorage.setItem(REMOTE_BACKGROUND_MODE_STORAGE_KEY, backgroundMode);
    }, [backgroundMode]);

    // A focused control that leaves with the sheet sends no blur; without this the window would stay lit.
    useEffect(() => {
        if (!sheet.isOpen && !document.activeElement?.matches(':focus-visible')) {
            setHasKeyboardFocus(false);
        }
    }, [sheet.isOpen]);

    const navigateTrack = (direction: 'prev' | 'next') => {
        handoff.recordNavIntent(direction);
        sendRemoteCommand({ type: direction === 'prev' ? 'previous' : 'next' });
    };

    return (
        <main
            className="remote-window"
            data-theme={snapshot.isDaylight ? 'light' : 'dark'}
            data-bg={backgroundMode}
            data-lit={isLit && !isIdle}
            data-idle={isIdle}
            data-sleeve={isSleeve}
            data-paused={snapshot.hasTrack && !isPlaying}
            data-sheet={sheet.isOpen}
            data-notitle={presentation.hideTitlebar || isDisplayOnly}
            onFocus={event => setHasKeyboardFocus(event.target.matches(':focus-visible'))}
            onBlur={() => setHasKeyboardFocus(false)}
        >
            <div ref={cardRef} className="remote-card">
                <div className="remote-paper">
                    {backgroundMode === 'cover' && (
                        <>
                            <RemoteCoverFaces handoff={handoff} imageClassName="remote-wash" reduceMotion={reduceMotion} />
                            <div className="remote-wash-shade" />
                        </>
                    )}
                </div>

                <div className="remote-face" style={REMOTE_DRAG_STYLE}>
                    {backgroundMode === 'transparent' && <div className="remote-glass" />}

                    <div className="remote-stage" aria-hidden={sheet.isOpen}>
                        <RemoteSongLine mode={shownLine ? 'line' : 'card'} handoff={handoff} reduceMotion={reduceMotion} />
                        <RemoteOutgoingRecede handoff={handoff} reduceMotion={reduceMotion}>
                            <RemoteLyricBlock
                                line={shownLine}
                                nextLine={lyricGivesWay ? null : lyric.nextLine}
                                isSinging={lyric.isSinging}
                                subtitleContentMode={snapshot.subtitleContentMode}
                                clock={clock}
                                lyricOffsetSec={lyricOffsetSec}
                                reduceMotion={reduceMotion}
                            />
                        </RemoteOutgoingRecede>
                    </div>

                    <AnimatePresence>
                        {sheet.isOpen && sheet.tab && (
                            <RemoteSheet
                                key="sheet"
                                tab={sheet.tab}
                                snapshot={snapshot}
                                alwaysOnTopSupported={presentation.alwaysOnTopSupported}
                                choices={choices}
                                primaryDisabled={primaryDisabled}
                                reduceMotion={reduceMotion}
                                onTabChange={sheet.setTab}
                                onClose={sheet.close}
                            />
                        )}
                    </AnimatePresence>

                    <RemoteWindowTools
                        backgroundMode={backgroundMode}
                        alwaysOnTopSupported={presentation.alwaysOnTopSupported}
                        onCycleBackgroundMode={() => setBackgroundMode(previous => (
                            previous === 'default' ? 'cover' : previous === 'cover' ? 'transparent' : 'default'
                        ))}
                    />

                    <RemoteProgressLine
                        clock={clock}
                        duration={duration}
                        disabled={primaryDisabled || isDisplayOnly}
                        isTransitionGlowActive={handoff.isTransitionGlowActive}
                        seekLabel={t('ui.seek')}
                        onSeek={time => sendRemoteCommand({ type: 'seek', time })}
                    />

                    {!isDisplayOnly && (
                        <RemoteKeyRow
                            snapshot={snapshot}
                            clock={clock}
                            primaryDisabled={primaryDisabled}
                            isSheetOpen={sheet.isOpen}
                            isExportBusy={exportBusy}
                            onToggleSheet={sheet.toggle}
                            onNavigate={navigateTrack}
                        />
                    )}
                </div>

                <div className="remote-ring" />
            </div>
        </main>
    );
};

export default RemoteControlApp;

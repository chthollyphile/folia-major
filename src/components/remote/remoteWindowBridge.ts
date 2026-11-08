import { useEffect, useState } from 'react';
import type React from 'react';
import { PlayerState } from '../../types';
import type { RemoteControlCommand, RemoteControlSnapshot } from '../../types/remoteControl';
import { idleVideoExportState } from '../../types/videoExport';

// src/components/remote/remoteWindowBridge.ts
// What the remote window hears from the main process and says back: the playback snapshot, the
// window's own switches (and whether always-on-top works at all), whether the pointer is in the
// window, and the command sender.

export const sendRemoteCommand = (command: RemoteControlCommand) => {
    void window.electron?.sendRemoteControlCommand(command);
};

/** The card drags the window; everything pressable opts out, or the press would move the window instead. */
export const REMOTE_DRAG_STYLE = { WebkitAppRegion: 'drag' } as React.CSSProperties;
export const REMOTE_NO_DRAG_STYLE = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;

const EMPTY_REMOTE_SNAPSHOT: RemoteControlSnapshot = {
    hasTrack: false,
    trackKey: null,
    title: null,
    artist: null,
    coverUrl: null,
    currentTime: 0,
    duration: 0,
    playerState: PlayerState.IDLE,
    loopMode: 'off',
    canGoPrevious: false,
    canGoNext: false,
    prevTrackKey: null,
    prevTrackTitle: null,
    prevTrackArtist: null,
    prevTrackCoverUrl: null,
    nextTrackKey: null,
    nextTrackTitle: null,
    nextTrackArtist: null,
    nextTrackCoverUrl: null,
    trackTransition: null,
    controlsDisabled: true,
    isStageActive: false,
    transparentModeEnabled: false,
    mainWindowClickThroughEnabled: false,
    mainWindowAlwaysOnTop: false,
    mainWindowBorderVisible: false,
    playerChromeHidden: false,
    playerChromeVisibilityMode: 'auto-hide',
    exportState: idleVideoExportState(),
    isDaylight: false,
    lyrics: null,
    subtitleContentMode: 'translation',
    isLiked: false,
    canLike: false,
    updatedAt: 0,
};

/** The latest snapshot. The 500 ms publishes leave the lyrics and the queue out, so the last ones sent are kept. */
export const useRemoteSnapshot = (): RemoteControlSnapshot => {
    const [snapshot, setSnapshot] = useState<RemoteControlSnapshot>(EMPTY_REMOTE_SNAPSHOT);

    useEffect(() => {
        let mounted = true;

        void window.electron?.getRemoteControlSnapshot?.().then(current => {
            if (mounted && current) {
                setSnapshot(previous => ({ ...previous, ...(current as RemoteControlSnapshot) }));
            }
        });

        const unsubscribe = window.electron?.onRemoteControlSnapshot?.(next => {
            const nextSnapshot = next as RemoteControlSnapshot;
            setSnapshot(previous => ({
                ...previous,
                ...nextSnapshot,
                lyrics: Object.prototype.hasOwnProperty.call(nextSnapshot, 'lyrics')
                    ? nextSnapshot.lyrics ?? null
                    : previous.lyrics ?? null,
                queue: Object.prototype.hasOwnProperty.call(nextSnapshot, 'queue')
                    ? nextSnapshot.queue
                    : previous.queue,
            }));
        });

        return () => {
            mounted = false;
            unsubscribe?.();
        };
    }, []);

    return snapshot;
};

export interface RemoteWindowPresentation {
    /** The settings switch "hide the title bar": the three window tools never show. */
    hideTitlebar: boolean;
    /** The window ignores the mouse: it is a display, and the key row is not drawn. */
    clickThrough: boolean;
    /** The settings switch "expand cover": when idle, the cover opens into the large sleeve. On by default. */
    expandCover: boolean;
    /** The settings switch "text shade": with the transparent background the idle type sits on a soft dark shade. Off by default. */
    textShade: boolean;
    /** False on native Wayland, where Electron cannot keep a window on top: both pin switches grey out. */
    alwaysOnTopSupported: boolean;
}

const DEFAULT_REMOTE_WINDOW_PRESENTATION: RemoteWindowPresentation = {
    hideTitlebar: false,
    clickThrough: false,
    expandCover: true,
    textShade: false,
    alwaysOnTopSupported: true,
};

export const useRemoteWindowPresentation = (): RemoteWindowPresentation => {
    const [presentation, setPresentation] = useState(DEFAULT_REMOTE_WINDOW_PRESENTATION);

    useEffect(() => {
        let mounted = true;
        const apply = (settings: Partial<RemoteWindowPresentation>) => {
            const next: RemoteWindowPresentation = {
                hideTitlebar: Boolean(settings.hideTitlebar),
                clickThrough: Boolean(settings.clickThrough),
                expandCover: settings.expandCover !== false,
                textShade: settings.textShade === true,
                alwaysOnTopSupported: settings.alwaysOnTopSupported !== false,
            };
            setPresentation(previous => (
                previous.hideTitlebar === next.hideTitlebar
                    && previous.clickThrough === next.clickThrough
                    && previous.expandCover === next.expandCover
                    && previous.textShade === next.textShade
                    && previous.alwaysOnTopSupported === next.alwaysOnTopSupported
                    ? previous
                    : next
            ));
        };

        void window.electron?.getRemoteControlWindowSettings?.().then(settings => {
            if (mounted && settings) {
                apply(settings);
            }
        });
        const unsubscribe = window.electron?.onRemoteControlWindowSettingsChanged?.(apply);

        return () => {
            mounted = false;
            unsubscribe?.();
        };
    }, []);

    return presentation;
};

/**
 * Whether the pointer is in the window.
 *
 * In the desktop app the answer comes from the main process, which compares the cursor's screen
 * position with the window's bounds: the card is a drag region, and on Windows a drag region
 * delivers no mouse events to the page, so the page cannot know by itself. Where the main
 * process cannot tell either (a Wayland session: it answers null) and without that bridge (the
 * page opened in a browser) the page's own mouse events are the source. On Wayland that is
 * expected to cover only the keys and the line: Electron's documentation says a drag region
 * ignores pointer events. Not tried on a Wayland session.
 * A click-through window never has the pointer.
 */
export const useRemotePointerInside = (clickThrough: boolean): boolean => {
    const [inside, setInside] = useState(false);

    useEffect(() => {
        const listenToOwnMouse = () => {
            const enter = () => setInside(true);
            const leave = () => setInside(false);
            document.addEventListener('mousemove', enter);
            document.documentElement.addEventListener('mouseleave', leave);
            return () => {
                document.removeEventListener('mousemove', enter);
                document.documentElement.removeEventListener('mouseleave', leave);
            };
        };

        const subscribe = window.electron?.onRemoteControlPointerInside;
        if (!subscribe) {
            return listenToOwnMouse();
        }

        let mounted = true;
        let heardChange = false;
        let stopOwnMouse: (() => void) | undefined;
        const unsubscribe = subscribe(next => {
            heardChange = true;
            setInside(next);
        });
        void window.electron?.getRemoteControlPointerInside?.().then(
            current => {
                if (!mounted) {
                    return;
                }
                if (current === null) {
                    stopOwnMouse = listenToOwnMouse();
                } else if (!heardChange) {
                    // A change that arrived before this answer is newer than it.
                    setInside(Boolean(current));
                }
            },
            // No first answer: the changes still arrive, and until one does the pointer counts as out.
            () => undefined,
        );
        return () => {
            mounted = false;
            unsubscribe();
            stopOwnMouse?.();
        };
    }, []);

    return inside && !clickThrough;
};

/** True while `value` is true, and for `lingerMs` after it turns false. */
export const useLingering = (value: boolean, lingerMs: number): boolean => {
    const [lingering, setLingering] = useState(value);

    useEffect(() => {
        if (value) {
            setLingering(true);
            return;
        }

        const timer = window.setTimeout(() => setLingering(false), lingerMs);
        return () => window.clearTimeout(timer);
    }, [value, lingerMs]);

    return value || lingering;
};

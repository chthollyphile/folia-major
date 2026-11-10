import { useCallback, useEffect, useRef, useState } from 'react';
import type { VideoExportStatus } from '../../types/videoExport';
import type { RemoteSheetTab } from './RemoteSheet';

// src/components/remote/useRemoteSheet.ts
// When the remote window's sheet is open and on which tab. "More" opens and closes it; a recording
// that starts brings its tab up; Esc closes it; and it leaves by itself when the pointer stays
// away, except while a recording is busy or a size is being typed.

/** The sheet goes back to the lyric this long after the pointer leaves. */
const SHEET_IDLE_CLOSE_MS = 6000;

type UseRemoteSheetParams = {
    exportStatus: VideoExportStatus;
    isExportBusy: boolean;
    pointerInside: boolean;
    /** A click-through window is a display: the sheet never shows. */
    isDisplayOnly: boolean;
};

export type RemoteSheetState = {
    tab: RemoteSheetTab | null;
    isOpen: boolean;
    setTab: (tab: RemoteSheetTab) => void;
    toggle: () => void;
    close: () => void;
};

export const useRemoteSheet = ({
    exportStatus,
    isExportBusy,
    pointerInside,
    isDisplayOnly,
}: UseRemoteSheetParams): RemoteSheetState => {
    const [tab, setTab] = useState<RemoteSheetTab | null>(null);
    const isOpen = tab !== null && !isDisplayOnly;

    // Turning click-through on closes the sheet for good, not only for as long as it lasts.
    useEffect(() => {
        if (isDisplayOnly) {
            setTab(null);
        }
    }, [isDisplayOnly]);

    // A recording that starts brings its tab up, but not in a display-only window: the tab would
    // wait there and open by itself when click-through is switched off.
    const lastExportStatusRef = useRef(exportStatus);
    useEffect(() => {
        if (exportStatus !== 'idle' && lastExportStatusRef.current === 'idle' && !isDisplayOnly) {
            setTab('export');
        }
        lastExportStatusRef.current = exportStatus;
    }, [exportStatus, isDisplayOnly]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setTab(null);
            }
        };
        window.addEventListener('keydown', closeOnEscape);
        return () => window.removeEventListener('keydown', closeOnEscape);
    }, [isOpen]);

    // A size is being typed: a text field has the caret and the window has the system's focus.
    // A window that lost the focus keeps its field as `document.activeElement`, so that alone
    // does not say it. Read again when a recording starts: that takes the size fields away, and a
    // field that is removed sends no event.
    const [isTyping, setIsTyping] = useState(false);
    useEffect(() => {
        if (!isOpen) {
            setIsTyping(false);
            return;
        }

        const sync = () => {
            const focused = document.activeElement;
            setIsTyping(document.hasFocus() && focused instanceof HTMLInputElement && focused.type === 'text');
        };
        const stop = () => setIsTyping(false);
        sync();
        document.addEventListener('focusin', sync);
        document.addEventListener('focusout', sync);
        window.addEventListener('focus', sync);
        window.addEventListener('blur', stop);
        return () => {
            document.removeEventListener('focusin', sync);
            document.removeEventListener('focusout', sync);
            window.removeEventListener('focus', sync);
            window.removeEventListener('blur', stop);
        };
    }, [isOpen, isExportBusy]);

    useEffect(() => {
        if (!isOpen || pointerInside || isExportBusy || isTyping) {
            return;
        }

        const timer = window.setTimeout(() => setTab(null), SHEET_IDLE_CLOSE_MS);
        return () => window.clearTimeout(timer);
    }, [isOpen, pointerInside, isExportBusy, isTyping]);

    const toggle = useCallback(() => {
        setTab(previous => (previous === null ? (isExportBusy ? 'export' : 'window') : null));
    }, [isExportBusy]);
    const close = useCallback(() => setTab(null), []);

    return { tab, isOpen, setTab, toggle, close };
};

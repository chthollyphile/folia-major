// src/utils/mediaKeyPressGate.ts
// One physical press can reach two paths: the three keys the main process holds on globalShortcut
// (useMediaKeyTakeoverBridge), and the app's own media session, navigator.mediaSession
// (useMediaSessionBridge). Both share this record, so one action runs once within SAME_PRESS_MS.

/** What one press is called on Folia's side: the taskbar buttons, the shortcuts and the media session. */
export type MediaKeyPressAction = 'previous' | 'play-pause' | 'next';

/**
  * Shorter than any repeated press: this is one press arriving twice, not two presses. The global
  * shortcut takes the key from the system first, so normally only one path receives it; this is the
  * fallback for the case where both do.
 */
export const SAME_PRESS_MS = 120;

/** The last press ran the same action this one does, and not long ago: this is that press arriving again. */
export const isRepeatedMediaKeyPress = (
    previous: { action: MediaKeyPressAction; atMs: number } | null,
    action: MediaKeyPressAction,
    nowMs: number,
): boolean => previous !== null && previous.action === action && nowMs - previous.atMs < SAME_PRESS_MS;

export type MediaKeyPressGate = {
    /** True and recorded when this press may run; false for the same action arriving again within SAME_PRESS_MS. */
    claim: (action: MediaKeyPressAction) => boolean;
};

export const createMediaKeyPressGate = (now: () => number = () => performance.now()): MediaKeyPressGate => {
    let last: { action: MediaKeyPressAction; atMs: number } | null = null;
    return {
        claim(action) {
            const atMs = now();
            if (isRepeatedMediaKeyPress(last, action, atMs)) return false;
            last = { action, atMs };
            return true;
        },
    };
};

/** The one both paths share (see the file header): a press runs from one of them only. */
export const mediaKeyPressGate = createMediaKeyPressGate();

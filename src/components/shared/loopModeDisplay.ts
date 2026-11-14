import { Repeat, Repeat1, RepeatOff } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { StageLoopMode } from '../../types';
// src/components/shared/loopModeDisplay.ts
// How the repeat button shows each repeat mode: its icon and the name of its label. Used by the
// side panel's song actions, the player bar's slot and the remote window.

export const loopModeIcon = (loopMode: StageLoopMode): LucideIcon => {
    if (loopMode === 'off') return RepeatOff;
    if (loopMode === 'one') return Repeat1;
    return Repeat;
};

/**
 * Whether the repeat button does nothing where it stands. Personal FM picks its own next song, so the
 * queue never repeats there (queueLoopMode): the control is greyed out rather than offering a mode
 * that cannot take effect. A stage that owns playback disables the whole transport, repeat included.
 */
export const loopToggleDisabledIn = (playbackControlsDisabled: boolean, isFmMode: boolean): boolean => (
    playbackControlsDisabled || isFmMode
);

/** The last part of the label's i18n key: the main window's labels are `player.<name>`, the remote window's `remote.<name>`. */
export const loopModeLabelName = (loopMode: StageLoopMode): 'loopOff' | 'loopOne' | 'loopAll' => {
    if (loopMode === 'off') return 'loopOff';
    if (loopMode === 'one') return 'loopOne';
    return 'loopAll';
};

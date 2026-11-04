import { normalizeNowPlayingCardPosition, type NowPlayingCardPosition } from './nowPlayingCardPosition';

// src/utils/obsNowPlayingCard.ts
// The now playing card as an OBS browser source draws it: the main window's mode, timeout and
// position, or null while the card is not meant to be in the source. Shared by the local source's
// published config and the web link's cfg, so both overlays decide the same way.

export type ObsNowPlayingCardMode = 'auto' | 'always';

export interface ObsNowPlayingCardConfig {
    mode: ObsNowPlayingCardMode;
    /** auto 模式下的显示时长（秒），3-60 */
    timeoutSec: number;
    /** Relative to the viewport, as stored; null keeps the default bottom-left spot. */
    position: NowPlayingCardPosition | null;
}

/** The card the source should draw, or null: off unless enabled for the source and the mode is not never. */
export const resolveObsNowPlayingCard = ({
    inObs,
    mode,
    timeoutSec,
    position,
}: {
    inObs: unknown;
    mode: unknown;
    timeoutSec: unknown;
    position: unknown;
}): ObsNowPlayingCardConfig | null => {
    // A web link's cfg is untrusted, so every field is read defensively; only a real true turns it on.
    if (inObs !== true || (mode !== 'auto' && mode !== 'always')) return null;
    const seconds = typeof timeoutSec === 'number' ? timeoutSec : NaN;
    return {
        mode,
        timeoutSec: Number.isFinite(seconds) ? Math.max(3, Math.min(60, Math.round(seconds))) : 10,
        position: normalizeNowPlayingCardPosition(position),
    };
};

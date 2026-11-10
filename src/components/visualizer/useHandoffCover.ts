import { useState } from 'react';
import type { VisualizerSharedProps, VisualizerSongHandoff } from './definition';

// src/components/visualizer/useHandoffCover.ts
// The cover address the backdrop draws (VisualizerRenderer). A song's cover often comes again at
// another address (the network copy, then the cached one), and a background keyed on the address
// would change again for the same picture: mid-blend, dropping the outgoing background, or at the
// settle. So for a blend's incoming song it is the first address the hand-off gave, kept while that
// song is shown - except an object URL the song has since moved off, which its owner revokes.

/** A blend's incoming song and the cover address the backdrop keeps for it. */
export interface KeptHandoffCover {
    seed: string | number;
    coverUrl: string;
}

/**
 * The cover the backdrop keeps for a blend's incoming song: the first address the hand-off gave it,
 * kept while that song is shown (`shownSeed`), and dropped once another one is. After the blend it is
 * also dropped when it is a `blob:` address the song has moved off (`shownCoverUrl`): the player
 * revokes a cached cover's object URL as it replaces it, and a background mounted again on it (another
 * background, another style, back to the player page) would decode nothing for the rest of the song.
 * One change for the same picture is the lesser loss; inside the blend the drawn layers still hold it.
 */
export const keepHandoffCover = (
    kept: KeptHandoffCover | null,
    songHandoff: Pick<VisualizerSongHandoff, 'seed' | 'coverUrl'> | null,
    shownSeed: string | number | undefined,
    shownCoverUrl?: string | null,
): KeptHandoffCover | null => {
    const revocable = !songHandoff && kept !== null && kept.coverUrl.startsWith('blob:') && kept.coverUrl !== shownCoverUrl;
    const still = kept && kept.seed === shownSeed && !revocable ? kept : null;
    if (still || !songHandoff?.coverUrl) return still;
    return { seed: songHandoff.seed, coverUrl: songHandoff.coverUrl };
};

/** The cover address the backdrop draws, given the hand-off and the shown song's own seed and cover. */
export const useHandoffCover = (
    songHandoff: VisualizerSongHandoff | null,
    seed: VisualizerSharedProps['seed'],
    coverUrl: VisualizerSharedProps['coverUrl'],
): VisualizerSharedProps['coverUrl'] => {
    const [kept, setKept] = useState<KeptHandoffCover | null>(null);
    const next = keepHandoffCover(kept, songHandoff, songHandoff ? songHandoff.seed : seed, coverUrl);
    if (next !== kept) setKept(next);
    return next?.coverUrl ?? (songHandoff ? songHandoff.coverUrl : coverUrl);
};

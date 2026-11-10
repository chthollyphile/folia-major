import React, { useEffect } from 'react';
import { PlayerState } from '../../../../types';
import type { OmniExploreItem } from '../../../../types/onlineMusic';
import { bass, mid, treble } from '../../../../stores/motionSignals';
import { selectDisplayPlayerState, selectDisplaySong, usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { useReducedMotionFor } from '../../../../hooks/useReducedMotionFor';
import { isSamePlaybackSong } from '../../../../utils/appPlaybackGuards';

// src/components/app/home/explore/ExplorePlaying.tsx
// How an entry shows that it is the song on the player: its length gives way to a level mark,
// and while the song sounds its picture takes the beat. Both are what is really sounding (the
// player's analyser, motionSignals.ts), read whenever it changes (once a frame while anything
// sounds; through a silence that is exact the last values stay) and written as CSS variables onto
// the one entry they belong to, so that nothing renders with them; index.css draws from them.
// An entry marks itself with `data-explore-playing` and what of it takes the beat with
// `data-explore-beat`.

/** `sounding` while the song is heard, `held` while it is on the player and silent. */
export type Playing = 'sounding' | 'held' | null;

/** Whether `item` is the song on the player. */
export const usePlaying = (item: OmniExploreItem): Playing => usePlaybackStore(state => {
    if (item.kind !== 'song' || !isSamePlaybackSong(selectDisplaySong(state), item.song)) return null;
    return selectDisplayPlayerState(state) === PlayerState.PLAYING ? 'sounding' : 'held';
});

// The bass is followed quickly up and slowly down, so that a kick is a push and not a flicker...
const ATTACK_SECONDS = 0.03;
const RELEASE_SECONDS = 0.2;
// ...and a beat is how far it stands over what it has been of late: a bass that only goes on is none.
const AVERAGE_SECONDS = 0.7;
const PUSH = 5;
const SOUND_VARIABLES = ['--ex-beat', '--ex-low', '--ex-mid', '--ex-high'];
// The player writes its levels on a scale of 255.
const shareOf = (level: number) => Math.min(1, Math.max(0, level / 255));
const towards = (from: number, to: number, seconds: number, within: number) => from + (to - from) * (1 - Math.exp(-seconds / within));

/** Writes what sounds onto `entry` for as long as `playing` says its song is heard. */
export const useSound = (entry: React.RefObject<HTMLElement | null>, playing: Playing): void => {
    const calm = useReducedMotionFor('uiMicroMotion');
    const isOn = playing === 'sounding' && !calm;
    useEffect(() => {
        const element = entry.current;
        if (!isOn || !element) return undefined;
        // Both start from what sounds now: started from nothing, the first seconds of any sound
        // would stand over an average still catching up, and be shown as one long beat.
        let quick = shareOf(bass.get());
        let average = quick;
        let last = performance.now();
        const stop = bass.on('change', level => {
            const now = performance.now();
            const seconds = Math.min(0.1, (now - last) / 1000);
            last = now;
            const low = shareOf(level);
            quick = towards(quick, low, seconds, low > quick ? ATTACK_SECONDS : RELEASE_SECONDS);
            average = towards(average, low, seconds, AVERAGE_SECONDS);
            element.style.setProperty('--ex-beat', Math.min(1, Math.max(0, (quick - average) * PUSH)).toFixed(3));
            element.style.setProperty('--ex-low', quick.toFixed(3));
            // (The upper bands are weak beside the bass: their roots are drawn.)
            element.style.setProperty('--ex-mid', Math.sqrt(shareOf(mid.get())).toFixed(3));
            element.style.setProperty('--ex-high', Math.sqrt(shareOf(treble.get())).toFixed(3));
        });
        return () => {
            stop();
            for (const name of SOUND_VARIABLES) element.style.removeProperty(name);
        };
    }, [entry, isOn]);
};

// The mark of the song on the player, where its length is written otherwise: three levels,
// which rest low while nothing sounds.
export const Levels: React.FC<{ className: string }> = ({ className }) => (
    <span data-explore-levels aria-hidden className={`explore-levels ${className}`}><i /><i /><i /></span>
);

/** `Levels` as the chip a picture's length is written in. */
export const LEVELS_CHIP = 'absolute rounded-md bg-black/70 px-1.5 py-1 text-white/90';

// The ring that leaves the picture of the song that sounds with each beat; `round` is the picture's own.
export const BeatRing: React.FC<{ round: string }> = ({ round }) => <span aria-hidden className={`explore-ring ${round}`} />;

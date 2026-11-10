import type { SongResult } from '@/types';

// Associates a home FM launch with the exact queue handed to playback until it lands.
const landings = new WeakMap<SongResult[], () => void>();

export const registerPersonalFmLanding = (queue: SongResult[], onLanding: () => void): void => {
    landings.set(queue, onLanding);
};

export const takePersonalFmLanding = (queue: SongResult[]): (() => void) | undefined => {
    const onLanding = landings.get(queue);
    landings.delete(queue);
    return onLanding;
};

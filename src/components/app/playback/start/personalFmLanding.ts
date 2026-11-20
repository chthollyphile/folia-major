import type { SongResult } from '@/types';
import type { PersonalFmLaunch } from '@/types/personalFm';

// Associates a home FM launch with the exact queue handed to playback until it lands.
type PersonalFmLanding = (() => PersonalFmLaunch) | (() => void);
const landings = new WeakMap<SongResult[], PersonalFmLanding>();

export const registerPersonalFmLanding = (queue: SongResult[], onLanding: PersonalFmLanding): void => {
    landings.set(queue, onLanding);
};

export const takePersonalFmLanding = (queue: SongResult[]): PersonalFmLanding | undefined => {
    const onLanding = landings.get(queue);
    landings.delete(queue);
    return onLanding;
};

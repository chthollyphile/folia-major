import type { SongResult } from '../../../../types';
import { getExternalSong, installExternalPlayback, isExternalRoute, subscribeExternalPlayback } from '../../../../services/onlineMusic/externalPlayback';
import { omni } from '../../../../services/onlineMusic/omni';
import { getPlaybackSongKey } from '../../../../utils/appPlaybackGuards';
import { setSurfacePictureIn } from './surfaceShowing';

// src/components/app/playback/surface/surfaceMount.ts
// Which song's picture is in the surface box (plan §4.2), kept apart from React: a surface song plays on the
// external route (externalPlayback.ts), and its picture goes into the box as soon as the route takes the song,
// before the player is told to play it, and comes out when the route lets it go (another song, another engine,
// a stop). The box is the one SurfacePlaybackHost keeps under the player page for as long as the window lives;
// only the picture inside it changes. Each song gets a fresh element in the box, removed with its picture, so
// nothing a source left behind outlives its song.

type Mounted = {
    songKey: string;
    element: HTMLElement;
    unmount: () => void;
};

let box: HTMLElement | null = null;
let mounted: Mounted | null = null;
let stopListening: (() => void) | null = null;

const unmountPicture = (reason: string) => {
    const current = mounted;
    if (!current) return;
    mounted = null;
    try {
        current.unmount();
    } finally {
        current.element.remove();
    }
    console.info('[Surface] took the picture out', { songKey: current.songKey, reason });
    setSurfacePictureIn(false);
};

const mountPicture = (song: SongResult, into: HTMLElement) => {
    const element = document.createElement('div');
    element.style.cssText = 'position: absolute; inset: 0; overflow: hidden;';
    element.dataset.surfaceSong = getPlaybackSongKey(song);
    into.append(element);
    const unmount = omni.mountSurface(song, element);
    mounted = { songKey: getPlaybackSongKey(song), element, unmount: unmount ?? (() => undefined) };
    if (!unmount) {
        // The source put nothing in: the player page keeps its own background (the song still sounds).
        console.warn('[Surface] the source put no picture in', { songKey: mounted.songKey });
        return;
    }
    console.info('[Surface] put the picture in', { songKey: mounted.songKey });
    setSurfacePictureIn(true);
};

/** Brings the box in line with the external route: the picture of its song while that is a surface song, else none. */
const sync = () => {
    const song = isExternalRoute() ? getExternalSong() : null;
    const wanted = box && song && omni.playsOnSurface(song) ? song : null;
    const wantedKey = wanted ? getPlaybackSongKey(wanted) : null;
    if (mounted && mounted.songKey === wantedKey && mounted.element.parentElement === box) return;
    unmountPicture(wanted ? 'another song' : 'the route let it go');
    if (wanted && box) mountPicture(wanted, box);
};

/**
 * The box for the pictures, from the host component; null when it leaves the page. Answers what lets it go.
 * The route is followed from the first box on.
 */
export const attachSurfaceBox = (element: HTMLElement): (() => void) => {
    box = element;
    installExternalPlayback();
    stopListening ??= subscribeExternalPlayback(() => sync());
    sync();
    return () => {
        if (box !== element) return;
        unmountPicture('the box left the page');
        box = null;
        stopListening?.();
        stopListening = null;
    };
};


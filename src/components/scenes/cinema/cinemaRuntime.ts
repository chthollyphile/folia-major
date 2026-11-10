import * as THREE from 'three';
import { mixColors, parseColorChannels } from '../../visualizer/colorMix';
import type { SceneFactory, SceneSong } from '../definition';
import { viewpointRig, turnHead, type Head } from '../kit/camera';
import { createThreeStage } from '../kit/threeStage';
import { cinemaAcousticWorld } from './cinemaAcoustics';
import { publishCinemaAnchors, SCREEN_CORNERS } from './cinemaAnchors';
import { fitView, SEAT_HALF_TAN } from './cinemaCamera';
import { loadCinemaReel, thirdColors } from './cinemaReel';
import { createCinemaScene, type CinemaScene } from './cinemaScene';

// src/components/scenes/cinema/cinemaRuntime.ts
// The hall as a scene runtime: the kit's transparent canvas, the hall (cinemaScene.ts) seen from the
// user's seat the whole time (the camera never moves by itself; a drag turns the head), the screen's
// corners handed to the host each frame, where the user's lyric style and background show
// (the hall draws no lyrics and no picture of its own).
// A pause is an intermission (cinemaIntermission.ts) and play starts the music at once while the curtains
// open; at the end of the queue the house lights come up; an automix blend changes reels as it starts.
// The hall's lights are its own: the app's light or dark mode never reaches them; the cove takes a little
// of the dark one of the song's pair. The hall's sound: its room (cinemaAcoustics.ts) goes to ctx.sound once;
// the host puts the listener in the user's seat.

const WARM_WHITE = '#ffd6a8';
const SURFACE = 'screen';
/** How often the screen's picture is sampled for the hall's light. */
const SAMPLE_SECONDS = 0.25;

/** The cove strips take a little of the accent colour of the song's dark theme (linear). */
const coveOf = (song: SceneSong) => {
    const tinted = parseColorChannels(mixColors(WARM_WHITE, song.theme.dark.accentColor, 0.4)) ?? { r: 255, g: 214, b: 168 };
    return new THREE.Color().setRGB(tinted.r / 255, tinted.g / 255, tinted.b / 255, THREE.SRGBColorSpace);
};

export const createCinemaRuntime: SceneFactory = async (ctx) => {
    // The lens passes antialias the hall themselves; the canvas is transparent where a borrowed picture shows.
    const stage = createThreeStage(ctx, { alpha: true, antialias: false, fov: 36, near: 0.1, far: 90 });
    stage.renderer.domElement.style.pointerEvents = 'none';
    stage.camera.position.set(0, 4, 18);
    publishCinemaAnchors(ctx.anchors);
    ctx.sound.setAcoustics(cinemaAcousticWorld());
    // Built in a few slices, and every shader compiled before the first frame: a program first compiled
    // when it is drawn holds the page until it is done.
    const started = performance.now();
    let hall: CinemaScene | null = null;
    try {
        hall = await createCinemaScene();
        const built = performance.now();
        await hall.compile(stage.renderer, stage.camera);
        ctx.log.info(`built in ${Math.round(built - started)} ms, shaders compiled in ${Math.round(performance.now() - built)} ms`);
    } catch (error) {
        hall?.dispose();
        stage.dispose();
        throw error;
    }
    const disposers: (() => void)[] = [];
    let lightsUpAtEnd = false;

    // The user's seat, the head turned by dragging.
    const head: Head = { yaw: 0, pitch: 0 };
    const seat = viewpointRig(ctx, { head });

    // The projector's light: the cover's colours on the reel; a blend changes reels as it starts, so the hall's light moves on with the music.
    let onProjector: string | null | undefined;
    let reelToken = 0;
    const project = (url: string | null, animate: boolean) => {
        if (url === onProjector) return;
        onProjector = url;
        const token = ++reelToken;
        if (!url) {
            hall.setReel(null, animate);
            return;
        }
        void loadCinemaReel(url).then((reel) => {
            if (token !== reelToken) {
                reel?.texture.dispose();
                return;
            }
            if (reel) hall.setReel(reel, animate);
        });
    };
    let cove = coveOf(ctx.song.current());
    project(ctx.song.current().coverUrl, false);
    disposers.push(ctx.on('songChange', ({ song }) => {
        cove = coveOf(song);
        project(song.coverUrl, !ctx.player.paused());
        lightsUpAtEnd = false;
    }));
    disposers.push(ctx.on('blendStart', ({ next }) => {
        cove = coveOf(next);
        project(next.coverUrl, true);
    }));

    // The house lights: up by the scene's setting, and fully up once the queue has played out, until play.
    const houseLights = () => ctx.settings.get().houseLights === true;
    let lightsByHand = houseLights();
    // A pause closes the curtains unless the user turned that off: then the curtains never close, paused or not.
    const curtainsOnPause = () => ctx.settings.get().curtainsOnPause !== false;
    let closeOnPause = curtainsOnPause();
    disposers.push(ctx.settings.onChange(() => { lightsByHand = houseLights(); closeOnPause = curtainsOnPause(); }));
    disposers.push(ctx.on('queueEnd', () => { lightsUpAtEnd = true; }));
    disposers.push(ctx.on('play', () => { lightsUpAtEnd = false; }));

    // The hall is lit by what its screen shows (the user's lyric style and background), sampled a few times a
    // second while the film runs; without a sample (web build, still mode) by the reel's light, the cover's.
    let sampledAt = 0;
    let sampling = false;
    let disposed = false;
    const sampleScreen = (now: number) => {
        if (sampling || now - sampledAt < SAMPLE_SECONDS) return;
        sampling = true;
        sampledAt = now;
        void ctx.surfaces.sample(SURFACE, 24, 8).then((picture) => {
            sampling = false;
            if (!picture) return;
            const colors = disposed ? null : thirdColors(picture);
            picture.close();
            if (colors) hall.setScreenLight(colors);
        }, () => {
            sampling = false;
        });
    };

    const bufferSize = new THREE.Vector2();
    let lastNow = 0;
    let frames = 0;
    return {
        frame: ({ now }) => {
            // The host's dt is 0 while paused, but the intermission and the air in the hall go on.
            const dt = lastNow ? Math.min(0.1, Math.max(0, now - lastNow)) : 0;
            lastNow = now;
            const running = !ctx.player.paused();
            const { camera, renderer } = stage;
            turnHead(ctx, head);
            seat.update(camera, running ? dt : 0);
            fitView(camera, SEAT_HALF_TAN);
            camera.updateMatrixWorld();
            renderer.getDrawingBufferSize(bufferSize);
            // Reduced motion: the hall does not pulse with the music, and a pause plays no intermission (as in static mode).
            const calm = ctx.host.reducedMotion;
            const shutter = hall.update({
                dt,
                running,
                power: calm ? 0 : ctx.music.power(),
                bass: calm ? 0 : ctx.music.bands().bass,
                lightsUp: lightsByHand || lightsUpAtEnd,
                curtainsOnPause: closeOnPause,
                still: ctx.host.staticMode || calm,
                cove,
                camera,
                bufferSize,
            });
            hall.render(renderer, camera);
            if (ctx.host.staticMode) hall.setScreenLight(null);
            else if (running && shutter > 0) sampleScreen(now);
            // The bare screen covers the picture as the shutter closes; shut, the box goes (and takes no clicks).
            ctx.surfaces.place(SURFACE, shutter > 0 ? stage.projectQuad(SCREEN_CORNERS) : null);
            frames += 1;
            if (frames === 2) ctx.ready();
        },
        dispose: () => {
            disposers.forEach(dispose => dispose());
            disposed = true;
            reelToken += 1;
            hall.dispose();
            stage.dispose();
        },
    };
};

import * as THREE from 'three';
import { resolveThemeFontStack, resolveThemeFontWeight, resolveThemeTranslationFontStack } from '../../../utils/fontStacks';
import { mixColors, parseColorChannels } from '../../visualizer/colorMix';
import type { SceneFactory, SceneSong } from '../definition';
import { phaseDirector, seatRig, type CameraRig } from '../kit/camera';
import { createThreeStage } from '../kit/threeStage';
import { publishCinemaAnchors, SCREEN_CORNERS } from './cinemaAnchors';
import { fitView, SEAT_HALF_TAN, tourRig } from './cinemaCamera';
import { rasterCinemaCaption, shownCinemaLine } from './cinemaCaption';
import { loadCinemaReel } from './cinemaReel';
import { createCinemaScene } from './cinemaScene';

// src/components/scenes/cinema/cinemaRuntime.ts
// The hall as a scene runtime: the kit's transparent canvas, the hall (cinemaScene.ts) filmed from the
// user's seat while a line is sung and on its tour when the next line is far (the kit's phaseDirector),
// the screen's corners handed to the host each frame. The hall's own captions come from lineChange; a
// pause is an intermission (cinemaIntermission.ts) and play starts the music at once while the curtains
// open; at the end of the queue the house lights come up; an automix blend changes reels as it starts.
// The hall's lights are its own: the app's light or dark theme never reaches them, and what is borrowed
// onto the screen keeps the user's theme.

const WARM_WHITE = '#ffd6a8';
const SURFACE = 'screen';

/** The cove strips take a little of the song's accent colour (linear). */
const coveOf = (song: SceneSong) => {
    const tinted = parseColorChannels(mixColors(WARM_WHITE, song.theme.accentColor, 0.4)) ?? { r: 255, g: 214, b: 168 };
    return new THREE.Color().setRGB(tinted.r / 255, tinted.g / 255, tinted.b / 255, THREE.SRGBColorSpace);
};

export const createCinemaRuntime: SceneFactory = (ctx) => {
    // The lens passes antialias the hall themselves; the canvas is transparent where a borrowed picture shows.
    const stage = createThreeStage(ctx, { alpha: true, antialias: false, fov: 36, near: 0.1, far: 90 });
    stage.renderer.domElement.style.pointerEvents = 'none';
    stage.camera.position.set(0, 4, 18);
    publishCinemaAnchors(ctx.anchors);
    const hall = createCinemaScene();
    const disposers: (() => void)[] = [];
    let lightsUpAtEnd = false;

    // The seat: the kit's head turn (tighter while a line is sung), at a seated width of view.
    const seat = seatRig(ctx, { clampDeg: 12, singingClampDeg: 6 });
    const seated: CameraRig = {
        update: (camera, dt) => {
            seat.update(camera, dt);
            fitView(camera, SEAT_HALF_TAN);
            camera.updateMatrixWorld();
        },
    };
    const director = phaseDirector(ctx, { seat: seated, tour: tourRig(ctx) });

    // The projector: the cover on the reel; a blend changes reels as it starts, so the screen moves on with the music.
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

    // The hall's own captions: only while the screen shows the hall's lyrics, not the user's style.
    let captionKey = '';
    const refreshCaption = () => {
        const ownLyrics = !ctx.surfaces.uses(SURFACE).lyrics && ctx.display.showText();
        const lines = ctx.lyrics.lines();
        const index = ownLyrics ? shownCinemaLine(lines, ctx.lyrics.lineIndex(), ctx.player.lyricTime()) : -1;
        const line = index >= 0 ? lines[index] : null;
        const text = line?.fullText ?? null;
        const translation = line?.translation?.trim() || null;
        const { theme } = ctx.song.current();
        const key = text ? `${text}\n${translation ?? ''}\n${theme.fontStyle}|${theme.fontFamily ?? ''}` : '';
        if (key === captionKey) return;
        captionKey = key;
        hall.setCaption(text ? rasterCinemaCaption(text, translation, {
            stack: resolveThemeFontStack(theme),
            translationStack: resolveThemeTranslationFontStack(theme),
            weight: resolveThemeFontWeight(theme, 700),
        }) : null);
    };
    disposers.push(ctx.on('lineChange', refreshCaption));
    refreshCaption();

    // The house lights: up by the scene's setting, and fully up once the queue has played out, until play.
    const houseLights = () => ctx.settings.get().houseLights === true;
    let lightsByHand = houseLights();
    disposers.push(ctx.settings.onChange(() => { lightsByHand = houseLights(); }));
    disposers.push(ctx.on('queueEnd', () => { lightsUpAtEnd = true; }));
    disposers.push(ctx.on('play', () => { lightsUpAtEnd = false; }));

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
            director.update(camera, running ? dt : 0);
            // A line held on the film runs out between lines, without a lineChange.
            refreshCaption();
            hall.setHole(ctx.surfaces.uses(SURFACE).background);
            renderer.getDrawingBufferSize(bufferSize);
            hall.update({
                dt,
                running,
                power: ctx.music.power(),
                bass: ctx.music.bands().bass,
                lightsUp: lightsByHand || lightsUpAtEnd,
                still: ctx.host.staticMode,
                cove,
                camera,
                bufferSize,
            });
            hall.render(renderer, camera);
            ctx.surfaces.place(SURFACE, stage.projectQuad(SCREEN_CORNERS));
            frames += 1;
            if (frames === 2) ctx.ready();
        },
        dispose: () => {
            disposers.forEach(dispose => dispose());
            reelToken += 1;
            hall.dispose();
            stage.dispose();
        },
    };
};

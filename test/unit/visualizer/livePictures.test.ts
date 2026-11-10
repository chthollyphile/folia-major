import { describe, expect, it } from 'vitest';
import { panelMakesImages, panelPictureTheme } from '../../../src/components/panelTab/controls/panelPictures';
import { imageOf, keepImage, pictureKey, stylePictureKey, themeForPictures } from '../../../src/components/visualizer/preview/pictureImages';
import { afterTry, FIRST_IMAGE_REST_MS, IMAGE_TRIES, imageRest, NEW_IMAGE_REST_MS, pictureWants } from '../../../src/components/visualizer/preview/pictureRule';
import { claimRun, holdTurns, runningPicture, takeTurn, whenFree } from '../../../src/components/visualizer/preview/pictureTurns';
import { coverStage, fitStage, frameStage, placeOnStage } from '../../../src/components/visualizer/preview/previewScale';
import type { Theme } from '../../../src/types';

// test/unit/visualizer/livePictures.test.ts
// The rules of the small pictures of lyric styles that nobody sees by looking: how the window-sized
// stage is scaled into a picture's frame (and into the big sample), which picture runs, when an
// image is made, that images are made one at a time and one picture runs at a time, that none
// starts while the page switches its lyric style, and under which text an image is filed.
// The two "one at a time" rules failing shows far from here: the page stutters, or the playing
// page loses its WebGL context. An image made too often shows as the large sample stopping.

describe('the stage scaled into a picture', () => {
    it('covers a frame of another shape and is centred, so both sides are cut evenly', () => {
        // A 1440x900 window (16:10) in a 16:9 frame: the width decides, the height sticks out.
        const place = coverStage({ width: 1440, height: 900 }, { width: 160, height: 90 })!;
        expect(place.scale).toBeCloseTo(160 / 1440);
        expect(place.left).toBeCloseTo(0);
        expect(place.top).toBeCloseTo((90 - 900 * place.scale) / 2);
        expect(place.top).toBeLessThan(0);
    });

    it('lets the height decide in a frame that is taller than the window is', () => {
        const place = coverStage({ width: 1920, height: 1080 }, { width: 100, height: 100 })!;
        expect(place.scale).toBeCloseTo(100 / 1080);
        expect(place.top).toBeCloseTo(0);
        expect(place.left).toBeCloseTo((100 - 1920 * place.scale) / 2);
    });

    it('fills a frame of the window\'s own shape exactly', () => {
        expect(coverStage({ width: 1440, height: 900 }, { width: 144, height: 90 })).toEqual({ scale: 0.1, left: 0, top: 0 });
    });

    it('gives nothing while either has no size', () => {
        expect(coverStage({ width: 0, height: 900 }, { width: 100, height: 60 })).toBeNull();
        expect(coverStage({ width: 1440, height: 900 }, { width: 100, height: 0 })).toBeNull();
    });
});

describe('the stage fitted into the big sample', () => {
    it('shows all of the window in a wider box, the height deciding and the sides left empty evenly', () => {
        // A 1440x900 window in the sample's box of the lyric style window, about 2:1.
        const place = fitStage({ width: 1440, height: 900 }, { width: 772, height: 386 })!;
        expect(place.scale).toBeCloseTo(386 / 900);
        expect(place.top).toBeCloseTo(0);
        expect(place.left).toBeCloseTo((772 - 1440 * place.scale) / 2);
        expect(place.left).toBeGreaterThan(0);
    });

    it('lets the width decide in a box that is taller than the window is', () => {
        const place = fitStage({ width: 1920, height: 1080 }, { width: 600, height: 600 })!;
        expect(place.scale).toBeCloseTo(600 / 1920);
        expect(place.left).toBeCloseTo(0);
        expect(place.top).toBeCloseTo((600 - 1080 * place.scale) / 2);
        expect(place.top).toBeGreaterThan(0);
    });

    it('gives nothing while the box has no size', () => {
        expect(fitStage({ width: 1440, height: 900 }, { width: 0, height: 300 })).toBeNull();
    });
});

describe('the frame that cuts the big sample', () => {
    // Under the scale the stage's edges fall between device pixels, where a style's canvas and the
    // dim painted over it were cut differently: a bright line along the sample's right edge.
    it('cuts the empty sides an edge inside the stage, and reaches an edge past the box where the stage fills it', () => {
        const stage = { width: 1093, height: 1021 };
        const box = { width: 585, height: 484 };
        const { frame, place } = frameStage(stage, box, 1)!;
        // The height decides: the stage is fitted two edges past the box at the top and bottom.
        expect(place.scale).toBeCloseTo((484 + 4) / 1021);
        const scaledWidth = stage.width * place.scale;
        // Top and bottom: one edge past the box, which cuts the stage there.
        expect(frame.top).toBeCloseTo(-1);
        expect(frame.top + frame.height).toBeCloseTo(box.height + 1);
        // Left and right: one edge inside the stage, centred in the box.
        const stageLeft = frame.left + place.left;
        expect(stageLeft).toBeCloseTo((box.width - scaledWidth) / 2);
        expect(frame.left).toBeCloseTo(stageLeft + 1);
        expect(frame.left + frame.width).toBeCloseTo(stageLeft + scaledWidth - 1);
    });

    it('draws a style of another zoom, on the sample\'s stage, where that zoom frames it in the box', () => {
        // Monet's own stage inside its layer, on the stage framed at 1.15 (VisPlaygroundSampleStage).
        for (const box of [{ width: 1158, height: 1038 }, { width: 1158, height: 655 }]) {
            const base = frameStage({ width: 1840, height: 1160 }, box, 1, true, 1.15)!;
            const own = frameStage({ width: 1840, height: 1160 }, box, 1, true, 1.3)!;
            const onStage = placeOnStage(base.place, own.place);
            // Both corners of the own stage, through the base stage into the frame, and as framed alone.
            for (const [x, y] of [[0, 0], [own.stage.width, own.stage.height]]) {
                const inBase = { x: onStage.left + x * onStage.scale, y: onStage.top + y * onStage.scale };
                expect(base.place.left + inBase.x * base.place.scale).toBeCloseTo(own.place.left + x * own.place.scale);
                expect(base.place.top + inBase.y * base.place.scale).toBeCloseTo(own.place.top + y * own.place.scale);
            }
        }
    });

    it('places the stage from the frame\'s corner, one edge up and left of it', () => {
        const { frame, place } = frameStage({ width: 1024, height: 768 }, { width: 516, height: 445 }, 1)!;
        expect(place.left).toBe(-1);
        expect(place.top).toBe(-1);
        // The width decides here: the sides reach past the box, the top and bottom are cut inside the stage.
        expect(frame.left).toBeCloseTo(-1);
        expect(frame.left + frame.width).toBeCloseTo(516 + 1);
        expect(frame.top).toBeGreaterThan(0);
    });

    it('grows a filling stage along the spare side and reaches an edge past the box all round', () => {
        const windowSize = { width: 1840, height: 1160 };
        const box = { width: 1160, height: 1040 };
        const { frame, place, stage } = frameStage(windowSize, box, 1, true)!;
        // The width still decides the scale; the stage is only taller than the window.
        expect(stage.width).toBeCloseTo(windowSize.width);
        expect(stage.height).toBeGreaterThan(windowSize.height);
        expect(place.scale).toBeCloseTo((1160 + 4) / 1840);
        expect(frame.left).toBeCloseTo(-1);
        expect(frame.top).toBeCloseTo(-1);
        expect(frame.left + frame.width).toBeCloseTo(box.width + 1);
        expect(frame.top + frame.height).toBeCloseTo(box.height + 1);
    });

    it('zooms a filling stage in, as wide as the window, cut evenly past the same frame', () => {
        const windowSize = { width: 1840, height: 1160 };
        const box = { width: 1158, height: 1038 };
        const unzoomed = frameStage(windowSize, box, 1, true)!;
        const { frame, place, stage } = frameStage(windowSize, box, 1, true, 1.3)!;
        expect(place.scale).toBeCloseTo(unzoomed.place.scale * 1.3);
        expect(frame).toEqual(unzoomed.frame);
        // The window's width stays; the height is the window's or what the box shows, whichever is more.
        expect(stage.width).toBe(windowSize.width);
        expect(stage.height).toBeCloseTo(Math.max(windowSize.height, (box.height + 4) / place.scale));
        // Centred, and reaching at least an edge past the frame on every side.
        const right = place.left + stage.width * place.scale;
        const bottom = place.top + stage.height * place.scale;
        expect(place.left + right).toBeCloseTo(frame.width);
        expect(place.top + bottom).toBeCloseTo(frame.height);
        expect(place.left).toBeLessThanOrEqual(-1 + 1e-9);
        expect(right).toBeGreaterThanOrEqual(frame.width + 1 - 1e-9);
        expect(place.top).toBeLessThanOrEqual(-1 + 1e-9);
        expect(bottom).toBeGreaterThanOrEqual(frame.height + 1 - 1e-9);
    });

    it('gives nothing while either has no size', () => {
        expect(frameStage({ width: 1440, height: 900 }, { width: 0, height: 300 }, 1)).toBeNull();
        expect(frameStage({ width: 0, height: 900 }, { width: 400, height: 300 }, 1)).toBeNull();
    });
});

describe('the big sample on the listener\'s screen', () => {
    // App windows in CSS pixels, maximised (the screen over its scaling, less a 48px taskbar):
    // 1920x1080 at 100% and 150%, 2560x1440, 3840x2160 at 100% (at 150% it is 2560x1440), 2560x1080,
    // 1440x900, 1680x1050, 2880x1920 at 200%, 1366x768; and two windows that are not maximised.
    const windows = [
        [1920, 1032], [1280, 672], [2560, 1392], [3840, 2112], [2560, 1032], [1440, 852], [1680, 1002],
        [1440, 912], [1366, 720], [1000, 700], [800, 600],
    ].map(([width, height]) => ({ width, height }));
    // The room the sample's box has in the lyric style window and in Theme Park on such windows.
    const rooms = [[772, 394], [772, 692], [772, 246], [772, 544], [912, 160], [712, 360]].map(([width, height]) => ({ width, height }));
    // Two edges of the frame at each side, and a pixel the box's size is rounded by.
    const slackPx = 5;

    it('lays the style out on a stage of the screen\'s shape and shows it whole, at the box\'s size', () => {
        for (const window of windows) {
            for (const room of rooms) {
                // The box takes the window's shape, as large as the room allows (SampleBox), measured to whole pixels.
                const fit = fitStage(window, room)!;
                const box = { width: Math.round(window.width * fit.scale), height: Math.round(window.height * fit.scale) };
                const { place, stage } = frameStage(window, box, 1, true)!;
                // Scaled as the box is to the window, both ways: the window's shape, nothing zoomed in.
                expect(Math.abs(window.width * place.scale - box.width)).toBeLessThanOrEqual(slackPx);
                expect(Math.abs(window.height * place.scale - box.height)).toBeLessThanOrEqual(slackPx);
                // The stage is the window, grown by no more than the slack: the style lays out as on that screen.
                expect(stage.width).toBeGreaterThanOrEqual(window.width);
                expect(stage.height).toBeGreaterThanOrEqual(window.height);
                expect((stage.width - window.width) * place.scale).toBeLessThanOrEqual(slackPx);
                expect((stage.height - window.height) * place.scale).toBeLessThanOrEqual(slackPx);
            }
        }
    });
});

describe('what a picture does', () => {
    const state = (visible: boolean, chosen = false, active = false) => ({ visible, chosen, active });

    it('draws nothing off screen, whatever else holds', () => {
        expect(pictureWants(state(false, true, true))).toBe('nothing');
        expect(pictureWants(state(false, false, true))).toBe('nothing');
    });

    it('is an image on screen, and runs only under the pointer', () => {
        expect(pictureWants(state(true))).toBe('image');
        expect(pictureWants(state(true, false, true))).toBe('live');
    });

    it('never runs the chosen picture: the chosen style runs in the large sample', () => {
        expect(pictureWants(state(true, true))).toBe('image');
        expect(pictureWants(state(true, true, true))).toBe('image');
    });
});

describe('when a picture\'s image is made', () => {
    const picture = (over: Partial<Parameters<typeof imageRest>[0]> = {}) => imageRest({ allowed: true, wants: 'image', chosen: false, made: false, shows: false, tried: 0, ...over });

    it('makes none where the picker says images are not to be made now, whatever else holds', () => {
        expect(picture({ allowed: false })).toBeNull();
        expect(picture({ allowed: false, shows: true })).toBeNull();
        expect(picture({ allowed: false, chosen: true })).toBeNull();
        expect(picture({ allowed: false, wants: 'live' })).toBeNull();
    });

    it('makes none off screen, and none where one of the same settings exists', () => {
        expect(picture({ wants: 'nothing' })).toBeNull();
        expect(picture({ made: true, shows: true })).toBeNull();
        // Known that nothing can be drawn: not tried again.
        expect(picture({ made: true })).toBeNull();
    });

    it('makes the first one once a window has arrived, also for the chosen and the pointed picture', () => {
        expect(picture()).toBe(FIRST_IMAGE_REST_MS);
        expect(picture({ chosen: true })).toBe(FIRST_IMAGE_REST_MS);
        expect(picture({ wants: 'live' })).toBe(FIRST_IMAGE_REST_MS);
    });

    it('waits longer before it makes one again', () => {
        expect(picture({ shows: true })).toBe(NEW_IMAGE_REST_MS);
        expect(NEW_IMAGE_REST_MS).toBeGreaterThan(FIRST_IMAGE_REST_MS);
    });

    it('leaves the chosen picture as it is while it is chosen: its style is the one being adjusted', () => {
        expect(picture({ chosen: true, shows: true })).toBeNull();
    });

    it('asks again later, not at once, after a try that came to nothing', () => {
        expect(picture({ tried: 1 })).toBe(NEW_IMAGE_REST_MS);
    });
});

describe('what becomes of a try to make an image', () => {
    it('keeps what a stage shows', () => {
        expect(afterTry('shown', 0)).toBe('keep');
        expect(afterTry('shown', 1)).toBe('keep');
    });

    it('files nothing for an empty stage and tries once more, then lets the glyph stand in', () => {
        expect(IMAGE_TRIES).toBe(2);
        expect(afterTry('empty', 0)).toBe('again');
        expect(afterTry('empty', 1)).toBe('glyph');
    });

    it('does not try again after a throw: the glyph stands in at once', () => {
        expect(afterTry('failed', 0)).toBe('glyph');
    });
});

describe('images are made one at a time', () => {
    it('starts the first ask at once and the next when the turn is given back, in the order asked', () => {
        const started: string[] = [];
        const giveBack = ['a', 'b', 'c'].map(name => takeTurn(() => started.push(name)));
        expect(started).toEqual(['a']);
        giveBack[0]();
        expect(started).toEqual(['a', 'b']);
        giveBack[1]();
        expect(started).toEqual(['a', 'b', 'c']);
        giveBack[2]();
    });

    it('passes over an ask that was taken back while it waited', () => {
        const started: string[] = [];
        const giveBack = ['a', 'b', 'c'].map(name => takeTurn(() => started.push(name)));
        giveBack[1]();
        giveBack[0]();
        expect(started).toEqual(['a', 'c']);
        giveBack[2]();
    });

    it('does nothing when a turn is given back twice', () => {
        const started: string[] = [];
        const first = takeTurn(() => started.push('a'));
        const second = takeTurn(() => started.push('b'));
        first();
        first();
        expect(started).toEqual(['a', 'b']);
        second();
        const third = takeTurn(() => started.push('c'));
        expect(started).toEqual(['a', 'b', 'c']);
        third();
    });
});

describe('one picture runs at a time', () => {
    it('stops the picture that ran when another starts', () => {
        const stopFirst = claimRun('first');
        expect(runningPicture()).toBe('first');
        const stopSecond = claimRun('second');
        expect(runningPicture()).toBe('second');
        // The first one stopping later must not stop the second.
        stopFirst();
        expect(runningPicture()).toBe('second');
        stopSecond();
        expect(runningPicture()).toBeNull();
    });
});

describe('no picture starts while the page switches its lyric style', () => {
    it('starts a picture at once when nothing holds them back', () => {
        const started: string[] = [];
        whenFree(() => started.push('a'));
        expect(started).toEqual(['a']);
    });

    it('starts one asked during a hold when the last hold is let go, and only once', () => {
        const started: string[] = [];
        const letGoA = holdTurns();
        const letGoB = holdTurns();
        whenFree(() => started.push('a'));
        letGoA();
        letGoA();
        expect(started).toEqual([]);
        letGoB();
        expect(started).toEqual(['a']);
        const letGoC = holdTurns();
        letGoC();
        expect(started).toEqual(['a']);
    });

    it('starts none that was taken back while it waited', () => {
        const started: string[] = [];
        const letGo = holdTurns();
        const takeBack = whenFree(() => started.push('gone'));
        whenFree(() => started.push('kept'));
        takeBack();
        letGo();
        expect(started).toEqual(['kept']);
    });
});

describe('when an image is made anew', () => {
    it('files equal settings under the same text and other settings under another', () => {
        const key = (scale: number) => pictureKey(['style', 'classic', { width: 1440, height: 900 }, { backgroundColor: '#000' }, scale]);
        expect(key(1)).toBe(key(1));
        expect(key(1.1)).not.toBe(key(1));
    });

    it('tells uploaded pictures apart by which object they are, not by their data', () => {
        const one = { url: 'data:same' };
        const other = { url: 'data:same' };
        expect(pictureKey('x', one)).toBe(pictureKey('x', one));
        expect(pictureKey('x', one)).not.toBe(pictureKey('x', other));
        expect(pictureKey('x', null)).toBe(pictureKey('x', undefined));
    });

    it('files a theme under what a picture shows of it: not its name, description or provider', () => {
        const song: Theme = {
            name: 'Midnight harbour', description: 'A slow song', provider: 'ai',
            backgroundColor: '#0b1020', primaryColor: '#e8ecff', accentColor: '#7aa2ff', secondaryColor: '#7c86a8',
            fontStyle: 'sans', animationIntensity: 'normal',
        };
        const key = (theme: Theme) => pictureKey(['style', 'classic', themeForPictures(theme)]);
        expect(key({ ...song, name: 'Another song', description: 'Faster', provider: 'preset' })).toBe(key(song));
        expect(key({ ...song, accentColor: '#ff8a4c' })).not.toBe(key(song));
        expect(key({ ...song, fontStyle: 'serif' })).not.toBe(key(song));
        expect(key({ ...song, wordColors: [{ word: 'harbour', color: '#fff' }] })).not.toBe(key(song));
        // What the styles print of a theme is not in a picture either.
        expect(themeForPictures(song)).toMatchObject({ name: '', description: undefined, provider: undefined });
    });

    it('files a lyric style\'s picture under its own tuning and under what mods add to it', () => {
        const shows = {
            mode: 'mod:someone:style', stage: { width: 1440, height: 900 }, theme: themeForPictures({
                name: 'x', backgroundColor: '#000', primaryColor: '#fff', accentColor: '#fff', secondaryColor: '#888', fontStyle: 'sans', animationIntensity: 'normal',
            }),
            isDaylight: false, sample: 'default', fontScale: 1, tuning: undefined, modSettings: { speed: 1 }, modTunings: {},
        };
        expect(stylePictureKey({ ...shows })).toBe(stylePictureKey(shows));
        // A mod style's own setting changed: its picture is another one.
        expect(stylePictureKey({ ...shows, modSettings: { speed: 2 } })).not.toBe(stylePictureKey(shows));
        // Another mod put a multiplier on a built-in style.
        expect(stylePictureKey({ ...shows, mode: 'sonnet', modSettings: null, modTunings: { cameraIntensity: 1.5 } }))
            .not.toBe(stylePictureKey({ ...shows, mode: 'sonnet', modSettings: null }));
        expect(stylePictureKey({ ...shows, mode: 'sonnet', modSettings: null, tuning: { cameraIntensity: 1 } }))
            .not.toBe(stylePictureKey({ ...shows, mode: 'sonnet', modSettings: null, tuning: { cameraIntensity: 2 } }));
        expect(stylePictureKey({ ...shows, fontScale: 1.1 })).not.toBe(stylePictureKey(shows));
        expect(stylePictureKey({ ...shows, sample: 'reserved' })).not.toBe(stylePictureKey(shows));
    });

    it('has no image until one is kept, and remembers that nothing could be drawn', () => {
        expect(imageOf('not made')).toBeUndefined();
        keepImage('empty style', null);
        expect(imageOf('empty style')).toBeNull();
    });
});

describe('the player panel\'s pictures over a playing song', () => {
    it('makes images only for an open picker while a song plays, and freely while none does', () => {
        expect(panelMakesImages({ playing: true, pickerOpen: false })).toBe(false);
        expect(panelMakesImages({ playing: true, pickerOpen: true })).toBe(true);
        expect(panelMakesImages({ playing: false, pickerOpen: false })).toBe(true);
        expect(panelMakesImages({ playing: false, pickerOpen: true })).toBe(true);
    });

    it('keeps the pictures\' theme over a song change, also under an open picker, until a picker opens', () => {
        const [first, second] = ['theme of the first song', 'theme of the second song'];
        // The song changes while one plays: the pictures stay as they are, so none is made again.
        expect(panelPictureTheme(first, second, { playing: true, pickerOpens: false })).toBe(first);
        // A picker opens: the pictures take the playing theme.
        expect(panelPictureTheme(first, second, { playing: true, pickerOpens: true })).toBe(second);
        // Nothing plays: they follow the page.
        expect(panelPictureTheme(first, second, { playing: false, pickerOpens: false })).toBe(second);
    });
});

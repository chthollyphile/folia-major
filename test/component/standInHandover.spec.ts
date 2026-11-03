import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

// test/component/standInHandover.spec.ts
// The handover of a page's stand-in to its centred card (the "hero"), on the real GridView: the
// stand-in turns over into the hero once the flight has landed and the hero's own picture is
// there (src/library/suites/grid/transitions/standInHandover.ts).
//
// Why in a browser: what can go wrong is what is on the screen in which frame (both cards at
// once, a card that turns in with an empty plate, a card left hidden or turned), and that is
// only there to be read once the page is really laid out and animated.
//
// The turn takes under half a second, less than a round trip of the test process, so a recorder
// in the page reads every animation frame and the test reads the recording once at the end.
// The probe opens the page as a flight to it does: with a plan that carries the picture that
// flies, taken back when the flight "lands".

/** One animation frame. Angles are degrees from flat; null where the element is not on the page. */
type Frame = {
    /** The frame's own time, which is the time its animations are computed at. */
    at: number;
    /** When the frame was read: later than `at` by as much as the main thread was late for it. */
    readAt: number;
    standIn: number | null;
    standInOpacity: number | null;
    hero: number | null;
    /** Of the element of the hero that is turned (it is held at 0 until the handover). */
    heroOpacity: number | null;
    /** The hero's picture has loaded and has something in it. */
    complete: boolean;
    /** The opacity the hero's picture is drawn with (a card brings its picture up by itself). */
    pictureOpacity: number | null;
};
type Recording = {
    frames: Frame[];
    // Three moments on the frames' clock, each stamped where it happens and not where a frame
    // first shows it: on a busy machine a frame may come a good 100 ms after what it shows, and
    // a time measured between two such frames says little. Null for what did not happen.
    /** The page was told that the flight had landed (the probe stamps it). */
    landedAt: number | null;
    /** The hero's card was put on the page: the handover begins in that commit. */
    heroCameAt: number | null;
    /** The hero's picture loaded. */
    pictureAt: number | null;
    /** The properties the Web Animations on the two cards animate. */
    animated: string[];
    /** The `perspective` of the box around each card, as computed. */
    standInPerspective: string | null;
    heroPerspective: string | null;
};

// Shown by a card under 85 degrees from flat that is not see-through.
const SHOWS_UNDER_DEG = 85;
// The stand-in gives way this long after the page is told that the flight has landed: half the
// carrier's dissolve (GIVES_WAY_AFTER_MS in standInHandover.ts).
const GIVES_WAY_AFTER_MS = 70;
// A stand-in that does not turn fades over its hero in this long.
const FADE_OVER_HERO_MS = 140;

const ORANGE = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#e8590c"/></svg>';
// The first track's picture: one that is there at once, and one the test serves when it likes.
const COVER_AT_ONCE = `data:image/svg+xml,${encodeURIComponent(ORANGE)}`;
const COVER_SERVED = '/__probe_cover__/first.svg';
// The picture the probe's flight brings (its LANDING_COVER), as another file of it: twice the size.
const BLUE_AT_ANOTHER_SIZE = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#3b5bdb"/></svg>';
// An address at another host, which the test serves (matched by its host: over http or https).
const COVER_ELSEWHERE = 'http://covers.probe.invalid/first-track.svg';
const ELSEWHERE = /covers\.probe\.invalid/;
// Looking at the two pictures takes 18 to 38 ms here, where neither has to be fetched, and is
// waited for 150 ms at most once the hero's picture is there (LIKENESS_WAIT_MS in standInHandover.ts).
const LIKENESS_WAIT_MS = 150;
// The hero's picture is waited for this long at most, from the hero's coming.
const PICTURE_WAIT_MS = 1200;

/** Starts the recorder; call BEFORE the page is opened. The hero is the card of the first track. */
const record = (page: Page, limitMs: number) => page.evaluate((limit) => {
    const recording: Recording = { frames: [], landedAt: null, heroCameAt: null, pictureAt: null, animated: [], standInPerspective: null, heroPerspective: null };
    const started = performance.now();
    const heroNow = () => {
        const title = [...document.querySelectorAll('[data-folia-grid-item-id] [data-folia-card-title]')].find(line => line.textContent === 'Track 0');
        return title?.closest('[data-folia-grid-item-id]')?.firstElementChild ?? null;
    };
    // Right after the commit that puts the hero on the page (the handover begins in it).
    const watch = new MutationObserver(() => {
        if (heroNow()) {
            recording.heroCameAt = performance.now() - started;
            watch.disconnect();
        }
    });
    watch.observe(document.body, { childList: true, subtree: true });
    // Before the picture's own listeners hear of it, the handover's among them.
    document.addEventListener('load', (event) => {
        if (recording.pictureAt === null && event.target instanceof HTMLImageElement && heroNow()?.contains(event.target)) {
            recording.pictureAt = performance.now() - started;
        }
    }, true);
    const angleOf = (element: Element) => {
        const turned = /(-?\d+(?:\.\d+)?(?:e-?\d+)?)deg/.exec(getComputedStyle(element).rotate);
        return turned ? Math.abs(Number(turned[1])) : 0;
    };
    const note = (element: Element) => {
        for (const animation of element.getAnimations()) {
            for (const frame of (animation.effect as KeyframeEffect).getKeyframes()) {
                for (const name of Object.keys(frame)) {
                    if (!['offset', 'easing', 'composite', 'computedOffset'].includes(name) && !recording.animated.includes(name)) {
                        recording.animated.push(name);
                    }
                }
            }
        }
    };
    (window as unknown as { __handover?: Promise<Recording> }).__handover = new Promise<Recording>((resolve) => {
        const step = (now: number) => {
            const standIn = document.querySelector('[data-folia-morph-target]')?.closest('[data-folia-morph-frame]') ?? null;
            const hero = heroNow();
            const picture = hero?.querySelector('img') ?? null;
            if (standIn) {
                note(standIn);
                recording.standInPerspective ??= getComputedStyle(standIn.parentElement!).perspective;
            }
            if (hero) {
                note(hero);
                recording.heroPerspective ??= getComputedStyle(hero.parentElement!).perspective;
            }
            const landed = (window as unknown as { __landedAt?: number }).__landedAt;
            if (recording.landedAt === null && landed !== undefined) {
                recording.landedAt = landed - started;
            }
            recording.frames.push({
                at: now - started,
                readAt: performance.now() - started,
                standIn: standIn ? angleOf(standIn) : null,
                standInOpacity: standIn ? Number(getComputedStyle(standIn).opacity) : null,
                hero: hero ? angleOf(hero) : null,
                heroOpacity: hero ? Number(getComputedStyle(hero).opacity) : null,
                complete: Boolean(picture && picture.complete && picture.naturalWidth > 0),
                pictureOpacity: picture ? Number(getComputedStyle(picture).opacity) : null,
            });
            if (now - started > limit) {
                resolve(recording);
                return;
            }
            requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    });
}, limitMs);

const read = (page: Page) => page.evaluate(() => (window as unknown as { __handover: Promise<Recording> }).__handover);

const open = (root: Locator) => root.locator('[data-probe-action="open-landing"]').click();

const standInShows = (frame: Frame) => frame.standIn !== null && frame.standIn < SHOWS_UNDER_DEG && frame.standInOpacity! > 0;
const heroShows = (frame: Frame) => frame.hero !== null && frame.hero < SHOWS_UNDER_DEG && frame.heroOpacity! > 0;
/** The first frame in which the stand-in has turned at all. */
const firstTurned = (frames: Frame[]) => frames.findIndex(frame => frame.standIn !== null && frame.standIn > 0);
/** The first frame with the hero on the page. When the hero came is `heroCameAt`, not this frame's time. */
const heroCame = (frames: Frame[]) => frames.find(frame => frame.hero !== null)!;
/** The frames in which the stand-in is part of the way through a fade. */
const fadingOf = (frames: Frame[]) => frames.filter(frame => frame.standInOpacity !== null && frame.standInOpacity > 0 && frame.standInOpacity < 1);
const lengthOf = (frames: Frame[]) => (frames.length > 0 ? frames[frames.length - 1].at - frames[0].at : Number.NaN);

/** What every handover to a hero ends in: no stand-in, and the hero flat and whole. */
const expectHandedOver = async (page: Page, frames: Frame[]) => {
    const last = frames[frames.length - 1];
    expect(last.standIn).toBeNull();
    expect(last.hero).toBe(0);
    expect(last.heroOpacity).toBe(1);
    await expect(page.locator('[data-folia-morph-target]')).toHaveCount(0);
};

/** A handover with no turn in it: neither card is ever off flat. */
const expectNoTurn = (frames: Frame[]) => {
    expect(frames.filter(frame => (frame.standIn ?? 0) !== 0 || (frame.hero ?? 0) !== 0)).toEqual([]);
};

type BareCard = (url: string) => Promise<HTMLElement>;
type HandOver = (standIn: HTMLElement, hero: HTMLElement, onOver: () => void, onSettled: () => void) => { land: () => void; cancel: () => void };

/**
 * Puts on the page what makes a card of the test's own: a box with `perspective`, and in it the
 * face that a handover turns, showing a picture that is already there. For what the grid's
 * cards cannot be brought to (a card's picture is loaded lazily, so it is never there in the
 * commit that mounts the card), and for a handover that the test itself calls off.
 */
const withBareCards = (page: Page) => page.evaluate(() => {
    (window as unknown as { __bareCard: BareCard }).__bareCard = async (url) => {
        const box = document.createElement('div');
        box.style.cssText = 'position:fixed;left:40px;top:40px;width:120px;height:120px;perspective:1200px;z-index:999';
        const face = document.createElement('div');
        const picture = new Image(120, 120);
        picture.src = url;
        await picture.decode();
        face.append(picture);
        box.append(face);
        document.body.append(box);
        return face;
    };
});

test('the stand-in turns over into the centred card: away to edge-on, then the card in from edge-on', async ({ mount, page }) => {
    const root = await mount('gridEntrancePerf', { firstCover: COVER_AT_ONCE });
    await record(page, 2400);
    await open(root);
    const { frames, landedAt, heroCameAt, animated, standInPerspective, heroPerspective } = await read(page);

    const turned = firstTurned(frames);
    expect(turned).toBeGreaterThan(0);
    // Around the middle of the turn: where one card goes edge-on and the other comes from it.
    const swap = frames.findIndex(frame => frame.hero !== null && frame.hero > 0 && frame.hero < 90);
    // eslint-disable-next-line no-console
    console.log('TURN', JSON.stringify({
        turnStartsMs: Math.round(frames[turned].at),
        afterLandingMs: Math.round(frames[turned].at - landedAt!),
        afterHeroCameMs: Math.round(frames[turned].at - heroCameAt!),
        around: frames.slice(Math.max(0, swap - 5), swap + 5).map(frame => ({
            ms: Math.round(frame.at - frames[turned].at),
            standIn: frame.standIn === null ? null : Number(frame.standIn.toFixed(1)),
            hero: frame.hero === null ? null : Number(frame.hero.toFixed(1)),
            heroOpacity: frame.heroOpacity,
            complete: frame.complete,
        })),
        animated, standInPerspective, heroPerspective,
    }));

    // Until the turn: the stand-in flat, and the hero out of sight from its first frame (held
    // see-through, then edge-on in the frame the turn starts in).
    for (const frame of frames.slice(0, turned)) {
        expect(frame.standIn ?? 0).toBe(0);
        expect(heroShows(frame)).toBe(false);
    }
    expect(frames.some(frame => frame.hero === 0 && frame.heroOpacity === 0)).toBe(true);
    // Not before the flight has landed and its carrier has half dissolved.
    expect(landedAt).not.toBeNull();
    expect(frames[turned].at).toBeGreaterThan(landedAt! + GIVES_WAY_AFTER_MS);
    // The stand-in only ever turns away, the hero only ever turns in, and the hero does not
    // start before the stand-in is edge-on (or gone).
    const standInAngles = frames.filter(frame => frame.standIn !== null).map(frame => frame.standIn!);
    expect(standInAngles.every((angle, index) => index === 0 || angle >= standInAngles[index - 1])).toBe(true);
    const heroAngles = frames.slice(turned).map(frame => frame.hero!);
    expect(heroAngles.every((angle, index) => index === 0 || angle <= heroAngles[index - 1])).toBe(true);
    expect(heroAngles[0]).toBe(90);
    for (const frame of frames.slice(turned)) {
        if (frame.hero! < 90) expect(frame.standIn ?? 90).toBeGreaterThanOrEqual(89.9);
    }
    // Both were seen turning, and in no frame are both of them shown.
    expect(standInAngles.some(angle => angle > 0 && angle < 90)).toBe(true);
    expect(swap).toBeGreaterThan(turned);
    expect(frames.filter(frame => standInShows(frame) && heroShows(frame))).toEqual([]);
    // The hero turns in with its picture.
    expect(frames[turned].complete).toBe(true);
    // Nothing but what the compositor carries moves the two cards.
    expect(animated.sort()).toEqual(['opacity', 'rotate']);
    expect(standInPerspective).toBe('1200px');
    expect(heroPerspective).toBe('1200px');

    await expectHandedOver(page, frames);
});

test('nothing turns before the centred card has its picture', async ({ mount, page }) => {
    // The picture comes 600 ms after it is asked for. The flight lands early, so that the
    // handover has nothing left to wait for but the picture.
    await page.route(`**${COVER_SERVED}`, async (route) => {
        await new Promise(resolve => setTimeout(resolve, 600));
        await route.fulfill({ contentType: 'image/svg+xml', body: ORANGE });
    });
    const root = await mount('gridEntrancePerf', { firstCover: COVER_SERVED, landingMs: 100 });
    await record(page, 2400);
    await open(root);
    const { frames, heroCameAt, pictureAt } = await read(page);

    const turned = firstTurned(frames);
    const heroShown = frames.find(heroShows);
    // eslint-disable-next-line no-console
    console.log('LATE PICTURE', JSON.stringify({
        pictureAfterHeroCameMs: Math.round(pictureAt! - heroCameAt!),
        turnAfterPictureMs: Math.round(frames[turned]?.at - pictureAt!),
        pictureOpacityWhenHeroShows: heroShown?.pictureOpacity,
    }));

    expect(turned).toBeGreaterThan(0);
    // The picture did come late: long after the flight had landed and the carrier dissolved.
    expect(pictureAt! - heroCameAt!).toBeGreaterThan(400);
    for (const frame of frames.filter(candidate => !candidate.complete)) {
        expect(frame.standIn ?? 0).toBe(0);
        if (frame.hero !== null) expect(frame.heroOpacity).toBe(0);
    }
    expect(frames[turned].complete).toBe(true);
    // And then it turns: it does not go on waiting until the 1.2 s are up, which is 600 ms more.
    // (Upper limits on a time are kept wide in this file. A busy machine adds to such a time:
    // with half the cores taken, a stand-in was seen to give way 150 ms late.)
    expect(frames[turned].at - pictureAt!).toBeLessThan(400);
    // A card brings its picture up by a fade of its own once it has loaded: the hero is not
    // shown half way through it.
    expect(heroShown?.pictureOpacity).toBe(1);

    await expectHandedOver(page, frames);
});

test('a picture that never comes does not keep the stand-in: it turns after about 1.35 s', async ({ mount, page }) => {
    // Never answered: not to the card, and not to the reading of it either.
    await page.route(`**${COVER_SERVED}`, () => {});
    const root = await mount('gridEntrancePerf', { firstCover: COVER_SERVED });
    await record(page, 3600);
    await open(root);
    const { frames, heroCameAt } = await read(page);
    await page.unrouteAll({ behavior: 'ignoreErrors' });

    const turned = firstTurned(frames);
    // eslint-disable-next-line no-console
    console.log('NO PICTURE', JSON.stringify({ turnAfterHeroCameMs: Math.round(frames[turned]?.at - heroCameAt!) }));

    expect(turned).toBeGreaterThan(0);
    expect(frames[turned].complete).toBe(false);
    // Not before its time, and not long after: 1.2 s for the picture, and 0.15 s more for the
    // word on whether it is the stand-in's. Wide on the late side: some 1.6 s after a page opens
    // here the probe ends its own measurement and renders again, which holds the main thread,
    // and on a slow run the wait ends inside that.
    expect(frames[turned].at - heroCameAt!).toBeGreaterThan(PICTURE_WAIT_MS + LIKENESS_WAIT_MS - 50);
    expect(frames[turned].at - heroCameAt!).toBeLessThan(2100);

    await expectHandedOver(page, frames);
});

test('a picture that fails is not waited for either: the stand-in turns once the flight has landed', async ({ mount, page }) => {
    await page.route(`**${COVER_SERVED}`, route => route.abort());
    const root = await mount('gridEntrancePerf', { firstCover: COVER_SERVED });
    await record(page, 2400);
    await open(root);
    const { frames, landedAt, heroCameAt } = await read(page);
    await page.unrouteAll({ behavior: 'ignoreErrors' });

    const turned = firstTurned(frames);
    // eslint-disable-next-line no-console
    console.log('PICTURE FAILS', JSON.stringify({
        heroCameMs: Math.round(heroCameAt!), landedMs: Math.round(landedAt!), turnStartsMs: Math.round(frames[turned]?.at),
    }));

    expect(turned).toBeGreaterThan(0);
    expect(frames[turned].complete).toBe(false);
    // Once the flight has landed and the hero is there, and not after the 1.2 s that a picture
    // is waited for (which would be some 1000 ms later here).
    expect(frames[turned].at).toBeGreaterThan(landedAt! + GIVES_WAY_AFTER_MS);
    expect(frames[turned].at - Math.max(landedAt! + GIVES_WAY_AFTER_MS, heroCameAt!)).toBeLessThan(500);

    await expectHandedOver(page, frames);
});

test('a centred card that shows the same picture is not turned into: the stand-in fades over it', async ({ mount, page }) => {
    const root = await mount('gridEntrancePerf', { albumCover: true });
    await record(page, 2400);
    await open(root);
    const { frames, animated } = await read(page);

    const fading = fadingOf(frames);
    // eslint-disable-next-line no-console
    console.log('SAME PICTURE', JSON.stringify({ fadeStartsMs: Math.round(fading[0]?.at), fadesForMs: Math.round(lengthOf(fading)), animated }));

    expectNoTurn(frames);
    // The hero is shown beneath the stand-in for as long as that fades.
    expect(fading.length).toBeGreaterThan(0);
    expect(fading.filter(frame => frame.heroOpacity !== 1)).toEqual([]);
    expect(lengthOf(fading)).toBeLessThanOrEqual(FADE_OVER_HERO_MS);
    expect(animated).toEqual(['opacity']);

    await expectHandedOver(page, frames);
});

test('a centred card that shows the same picture from another address is not turned into either', async ({ mount, page }) => {
    // The picture that flies in, as another file of the artwork at another host's address: the
    // two addresses have nothing in common, and the host lets its pictures be read.
    const asked: string[] = [];
    await page.route(ELSEWHERE, (route) => {
        asked.push(route.request().headers().origin ? 'to read' : 'to show');
        return route.fulfill({ contentType: 'image/svg+xml', body: BLUE_AT_ANOTHER_SIZE, headers: { 'access-control-allow-origin': '*' } });
    });
    const root = await mount('gridEntrancePerf', { firstCover: COVER_ELSEWHERE });
    await record(page, 2400);
    await open(root);
    const { frames, landedAt, heroCameAt, pictureAt, animated } = await read(page);

    const fading = fadingOf(frames);
    // eslint-disable-next-line no-console
    console.log('SAME PICTURE ELSEWHERE', JSON.stringify({
        heroCameMs: Math.round(heroCameAt!), pictureMs: Math.round(pictureAt!), landedMs: Math.round(landedAt!),
        fadeStartsMs: Math.round(fading[0]?.at), fadesForMs: Math.round(lengthOf(fading)), animated, asked,
    }));

    // The picture was asked for twice: by the card, and once more to be read.
    expect(asked).toContain('to show');
    expect(asked).toContain('to read');

    expectNoTurn(frames);
    expect(fading.length).toBeGreaterThan(0);
    expect(fading.filter(frame => frame.heroOpacity !== 1 || !frame.complete)).toEqual([]);
    expect(lengthOf(fading)).toBeLessThanOrEqual(FADE_OVER_HERO_MS);
    // Looking at the two pictures does not hold the handover up for long: the stand-in gives
    // way once the flight has landed and the card has its picture.
    expect(fading[0].at).toBeGreaterThan(landedAt! + GIVES_WAY_AFTER_MS);
    expect(fading[0].at - Math.max(landedAt! + GIVES_WAY_AFTER_MS, pictureAt!)).toBeLessThan(400);
    expect(animated).toEqual(['opacity']);

    await expectHandedOver(page, frames);
});

test('a picture whose host does not let it be read is taken for another picture: the stand-in turns', async ({ mount, page }) => {
    // The same file as above, from a host that allows reading to some other site only. The card
    // shows it all the same; it cannot be compared.
    await page.route(ELSEWHERE, route => route.fulfill({
        contentType: 'image/svg+xml', body: BLUE_AT_ANOTHER_SIZE, headers: { 'access-control-allow-origin': 'http://some.other.site.invalid' },
    }));
    const root = await mount('gridEntrancePerf', { firstCover: COVER_ELSEWHERE });
    await record(page, 2400);
    await open(root);
    const { frames, landedAt, pictureAt } = await read(page);

    const turned = firstTurned(frames);
    // eslint-disable-next-line no-console
    console.log('UNREADABLE PICTURE', JSON.stringify({ pictureMs: Math.round(pictureAt!), landedMs: Math.round(landedAt!), turnStartsMs: Math.round(frames[turned]?.at) }));

    expect(turned).toBeGreaterThan(0);
    expect(frames[turned].complete).toBe(true);
    // It is not held up for long: the stand-in gives way once the flight has landed and the
    // card has its picture. (That a picture which cannot be read is known for one before the
    // reading's 150 ms are up is put to cards of the test's own, below.)
    expect(frames[turned].at - Math.max(landedAt! + GIVES_WAY_AFTER_MS, pictureAt!)).toBeLessThan(400);

    await expectHandedOver(page, frames);
});

test('two addresses of one artwork are known for one picture though neither can be read', async ({ mount, page }) => {
    // One NetEase cover at two sizes, from two of its hosts, which let no one read their pictures here.
    const asked: string[] = [];
    await page.route(/music\.126\.net/, (route) => {
        asked.push(route.request().url().replace(/^https?:/, ''));
        return route.fulfill({ contentType: 'image/svg+xml', body: ORANGE, headers: { 'access-control-allow-origin': 'http://some.other.site.invalid' } });
    });
    const root = await mount('gridEntrancePerf', {
        flownCover: 'http://p1.music.126.net/aBc==/109951163.jpg?param=300y300',
        firstCover: 'http://p2.music.126.net/aBc==/109951163.jpg',
    });
    await record(page, 2400);
    await open(root);
    const { frames, animated } = await read(page);

    const fading = fadingOf(frames);
    // eslint-disable-next-line no-console
    console.log('ONE ARTWORK, UNREADABLE', JSON.stringify({ fadeStartsMs: Math.round(fading[0]?.at), animated, asked: [...new Set(asked)] }));

    // Both were shown, each from its own address.
    expect(new Set(asked).size).toBe(2);
    expectNoTurn(frames);
    expect(fading.length).toBeGreaterThan(0);
    expect(animated).toEqual(['opacity']);

    await expectHandedOver(page, frames);
});

test('a picture that is slow to be read again is not waited for: the stand-in turns once the reading has been waited for 150 ms', async ({ mount, page }) => {
    // The card is given its picture at once. Asked for again to be read, the picture takes 900 ms.
    await page.route(ELSEWHERE, async (route) => {
        if (route.request().headers().origin) await new Promise(resolve => setTimeout(resolve, 900));
        await route.fulfill({ contentType: 'image/svg+xml', body: BLUE_AT_ANOTHER_SIZE, headers: { 'access-control-allow-origin': '*' } });
    });
    // The flight lands early: the handover has nothing left to wait for but the pictures.
    const root = await mount('gridEntrancePerf', { firstCover: COVER_ELSEWHERE, landingMs: 100 });
    await record(page, 2400);
    await open(root);
    const { frames, pictureAt } = await read(page);

    const turned = firstTurned(frames);
    // eslint-disable-next-line no-console
    console.log('SLOW TO READ', JSON.stringify({ turnAfterPictureMs: Math.round(frames[turned]?.at - pictureAt!) }));

    // It turns, though the two pictures are one: it could not be told in time.
    expect(turned).toBeGreaterThan(0);
    // Not before the reading has been waited for, and not once the reading is in, which is
    // some 700 ms later.
    expect(frames[turned].at - pictureAt!).toBeGreaterThan(LIKENESS_WAIT_MS - 10);
    expect(frames[turned].at - pictureAt!).toBeLessThan(LIKENESS_WAIT_MS + 400);

    await expectHandedOver(page, frames);
});

test('a reading that comes after those 150 ms is still heeded where the stand-in has not given way yet', async ({ mount, page }) => {
    // Asked for again to be read, the picture takes 500 ms: longer than a reading is waited for.
    // The flight lands long after that, so the reading is in before the stand-in is to give way.
    await page.route(ELSEWHERE, async (route) => {
        if (route.request().headers().origin) await new Promise(resolve => setTimeout(resolve, 500));
        await route.fulfill({ contentType: 'image/svg+xml', body: BLUE_AT_ANOTHER_SIZE, headers: { 'access-control-allow-origin': '*' } });
    });
    const root = await mount('gridEntrancePerf', { firstCover: COVER_ELSEWHERE, landingMs: 1500 });
    await record(page, 3200);
    await open(root);
    const { frames, landedAt, heroCameAt, pictureAt, animated } = await read(page);

    const fading = fadingOf(frames);
    // eslint-disable-next-line no-console
    console.log('READ LATE, LANDED LATER', JSON.stringify({
        heroCameMs: Math.round(heroCameAt!), pictureMs: Math.round(pictureAt!), landedMs: Math.round(landedAt!),
        fadeStartsMs: Math.round(fading[0]?.at), turnStartsMs: Math.round(frames[firstTurned(frames)]?.at), animated,
    }));

    // The reading was asked for as the hero came and took 500 ms from then: it was not in when
    // it had been waited for (150 ms from the card's picture), and it was in before the landing.
    expect(pictureAt! + LIKENESS_WAIT_MS).toBeLessThan(heroCameAt! + 480);
    expect(landedAt!).toBeGreaterThan(heroCameAt! + 700);

    // The two pictures are one, and the stand-in knows by the time it goes: it fades.
    expectNoTurn(frames);
    expect(fading.length).toBeGreaterThan(0);
    expect(fading[0].at).toBeGreaterThan(landedAt! + GIVES_WAY_AFTER_MS);
    expect(animated).toEqual(['opacity']);

    await expectHandedOver(page, frames);
});

/**
 * Hands a stand-in over to a hero that has its picture as the handover begins, the flight having
 * landed: two cards of the test's own, on a page that is doing nothing else. The grid's cards
 * cannot be brought to this, and what is timed here is not mixed with their mounting.
 */
const handOverBareCards = async (page: Page, flown: string, own: string) => {
    await withBareCards(page);
    return page.evaluate(async (given) => {
        const { __bareCard: card, __handOverStandIn: handOverStandIn } = window as unknown as { __bareCard: BareCard; __handOverStandIn: HandOver };
        const standIn = await card(given.flown);
        const hero = await card(given.own);
        const complete = hero.querySelector('img')!.complete;
        const begun = performance.now();
        let settledAfter: number | null = null;
        // What the handover says, in the order it says it.
        const said: string[] = [];
        const handover = handOverStandIn(standIn, hero, () => { said.push('over'); }, () => {
            said.push('settled');
            settledAfter = performance.now() - begun;
        });
        handover.land();
        // Whether the stand-in gave way before the reading's wait was up, told by a timer of the
        // test's own, due 10 ms before that wait: timers fire in the order they are due, also on
        // a machine that is late for all of them, where a time read off a clock says little.
        let gaveWayBeforeTheWaitWasUp: boolean | null = null;
        setTimeout(() => { gaveWayBeforeTheWaitWasUp = standIn.getAnimations().length > 0; }, given.wait - 10);
        const until = async (reached: () => boolean) => {
            while (!reached() && performance.now() - begun < 3000) await new Promise(resolve => requestAnimationFrame(resolve));
        };
        // The first frame in which the stand-in is being moved.
        await until(() => standIn.getAnimations().length > 0);
        const gaveWayAfter = standIn.getAnimations().length > 0 ? performance.now() - begun : null;
        const moved = standIn.getAnimations().flatMap(animation => (animation.effect as KeyframeEffect).getKeyframes().flatMap(frame => Object.keys(frame)));
        await until(() => settledAfter !== null);
        return { complete, gaveWayAfter, gaveWayBeforeTheWaitWasUp, turned: moved.includes('rotate'), settledAfter, said };
    }, { flown, own, wait: LIKENESS_WAIT_MS });
};

test('a hero that has its picture from the first is not kept waiting for the reading either', async ({ mount, page }) => {
    // Asked for to be read, the hero's picture is never given.
    await page.route(ELSEWHERE, async (route) => {
        if (!route.request().headers().origin) await route.fulfill({ contentType: 'image/svg+xml', body: BLUE_AT_ANOTHER_SIZE });
    });
    await mount('gridEntrancePerf');
    const seen = await handOverBareCards(page, COVER_AT_ONCE, COVER_ELSEWHERE);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    // eslint-disable-next-line no-console
    console.log('PICTURE FROM THE FIRST', JSON.stringify(seen));

    expect(seen.complete).toBe(true);
    // It gives way once the reading has been waited for its 150 ms, and by a turn: the two
    // pictures could not be told to be one.
    expect(seen.gaveWayAfter).not.toBeNull();
    expect(seen.gaveWayBeforeTheWaitWasUp).toBe(false);
    expect(seen.gaveWayAfter!).toBeGreaterThan(LIKENESS_WAIT_MS - 10);
    expect(seen.gaveWayAfter!).toBeLessThan(1000);
    expect(seen.turned).toBe(true);
    // The stand-in is said to be over, and then, the hero having turned in, the handover settled.
    expect(seen.said).toEqual(['over', 'settled']);
});

test('a stand-in that only fades is said to be over before the handover is said to be settled', async ({ mount, page }) => {
    await mount('gridEntrancePerf');
    // One picture on both cards: nothing turns, and both words come of the one fade's end.
    const seen = await handOverBareCards(page, COVER_AT_ONCE, COVER_AT_ONCE);
    // eslint-disable-next-line no-console
    console.log('FADE ON BARE CARDS', JSON.stringify(seen));

    expect(seen.gaveWayAfter).not.toBeNull();
    expect(seen.turned).toBe(false);
    expect(seen.said).toEqual(['over', 'settled']);
});

test('that a picture cannot be read is known at once: the stand-in turns without the 150 ms', async ({ mount, page }) => {
    // The host allows reading to some other site only.
    await page.route(ELSEWHERE, route => route.fulfill({
        contentType: 'image/svg+xml', body: BLUE_AT_ANOTHER_SIZE, headers: { 'access-control-allow-origin': 'http://some.other.site.invalid' },
    }));
    await mount('gridEntrancePerf');
    const seen = await handOverBareCards(page, COVER_AT_ONCE, COVER_ELSEWHERE);
    // eslint-disable-next-line no-console
    console.log('UNREADABLE FROM THE FIRST', JSON.stringify(seen));

    expect(seen.complete).toBe(true);
    // As soon as the flight has landed (70 ms), before the reading's wait is up, and by a turn.
    expect(seen.gaveWayAfter).not.toBeNull();
    expect(seen.gaveWayAfter!).toBeGreaterThan(GIVES_WAY_AFTER_MS - 10);
    expect(seen.gaveWayBeforeTheWaitWasUp).toBe(true);
    expect(seen.turned).toBe(true);
});

// What a page that is left in mid-handover does (it calls the handover off as it unmounts). Put
// to the handover itself: of a page that is gone there is nothing left to look at.
test('a handover that is called off leaves nothing held or turned, and says nothing more', async ({ mount, page }) => {
    await mount('gridEntrancePerf');
    await withBareCards(page);
    const seen = await page.evaluate(async ({ flown, own }) => {
        const { __bareCard: card, __handOverStandIn: handOverStandIn } = window as unknown as { __bareCard: BareCard; __handOverStandIn: HandOver };
        const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
        const stateOf = (standIn: HTMLElement, hero: HTMLElement) => ({
            moving: standIn.getAnimations().length + hero.getAnimations().length,
            standIn: `${getComputedStyle(standIn).rotate} ${getComputedStyle(standIn).opacity}`,
            hero: `${getComputedStyle(hero).rotate} ${getComputedStyle(hero).opacity}`,
        });
        let said = 0;
        const say = () => { said += 1; };

        // Called off while it waits for the flight to land.
        const first = { standIn: await card(flown), hero: await card(own) };
        const waiting = handOverStandIn(first.standIn, first.hero, say, say);
        await wait(100);
        const heldAt = getComputedStyle(first.hero).opacity;
        waiting.cancel();
        const afterWaiting = stateOf(first.standIn, first.hero);
        // Told of the landing all the same, and given the time to give way in.
        waiting.land();
        await wait(500);
        const later = stateOf(first.standIn, first.hero);

        // Called off in mid-turn.
        const second = { standIn: await card(flown), hero: await card(own) };
        const turning = handOverStandIn(second.standIn, second.hero, say, say);
        turning.land();
        const began = performance.now();
        while (second.standIn.getAnimations().length === 0 && performance.now() - began < 3000) {
            await new Promise(resolve => requestAnimationFrame(resolve));
        }
        const midTurn = stateOf(second.standIn, second.hero);
        turning.cancel();
        const afterTurning = stateOf(second.standIn, second.hero);
        // Longer than the whole turn takes.
        await wait(700);
        return { heldAt, afterWaiting, later, midTurn, afterTurning, said };
    }, { flown: COVER_AT_ONCE, own: `data:image/svg+xml,${encodeURIComponent(BLUE_AT_ANOTHER_SIZE)}` });
    // eslint-disable-next-line no-console
    console.log('CALLED OFF', JSON.stringify(seen));

    const atRest = { moving: 0, standIn: 'none 1', hero: 'none 1' };
    // The hero was held out of sight, and is let go.
    expect(seen.heldAt).toBe('0');
    expect(seen.afterWaiting).toEqual(atRest);
    expect(seen.later).toEqual(atRest);
    // The turn had begun (the stand-in and the hero each with an animation), and is undone.
    expect(seen.midTurn.moving).toBe(2);
    expect(seen.afterTurning).toEqual(atRest);
    expect(seen.said).toBe(0);
});

test('tracks that come after the flight has landed: the stand-in waits for them, the cards fly in, and it turns over', async ({ mount, page }) => {
    const TRACKS_AFTER_MS = 1100;
    const root = await mount('gridEntrancePerf', { firstCover: COVER_AT_ONCE, tracksAfterMs: TRACKS_AFTER_MS });
    await record(page, 3200);
    // A card beside the centred one, read in the first frame it is on the page: what moves it.
    const besideAsked = page.evaluate(() => new Promise<string[] | null>((resolve) => {
        const started = performance.now();
        const look = () => {
            const title = [...document.querySelectorAll('[data-folia-grid-item-id] [data-folia-card-title]')].find(line => line.textContent === 'Track 1');
            const card = title?.closest('[data-folia-grid-item-id]')?.firstElementChild;
            if (card) {
                resolve(card.getAnimations().flatMap(animation => (animation.effect as KeyframeEffect).getKeyframes().flatMap(frame => Object.keys(frame))));
            } else if (performance.now() - started > 5000) {
                resolve(null);
            } else {
                requestAnimationFrame(look);
            }
        };
        requestAnimationFrame(look);
    }));
    await open(root);
    const { frames, landedAt, heroCameAt } = await read(page);
    const beside = await besideAsked;

    const turned = firstTurned(frames);
    const came = heroCame(frames);
    // eslint-disable-next-line no-console
    console.log('LATE TRACKS', JSON.stringify({ landedMs: Math.round(landedAt!), heroCameMs: Math.round(heroCameAt!), turnStartsMs: Math.round(frames[turned]?.at), besideMovedBy: [...new Set(beside)].sort() }));

    // The hero did come late: long after the flight had landed and the page's plan was taken
    // back (600 ms after, by the probe's two timers).
    expect(heroCameAt! - landedAt!).toBeGreaterThan(300);
    // Until then the stand-in stands, flat and whole, from the frame the page is there, which
    // is before the landing.
    const pageCame = frames.findIndex(frame => frame.standIn !== null);
    expect(frames[pageCame].at).toBeLessThan(landedAt!);
    for (const frame of frames.slice(pageCame).filter(candidate => candidate.at < came.at)) {
        expect(frame.standIn).toBe(0);
        expect(frame.standInOpacity).toBe(1);
    }
    // The cards that come then still fly in from around the stand-in ...
    expect(beside).toContain('translate');
    // ... and the hero is not shown before the stand-in has turned away.
    expect(turned).toBeGreaterThan(0);
    for (const frame of frames.slice(0, turned)) expect(heroShows(frame)).toBe(false);
    expect(frames.filter(frame => standInShows(frame) && heroShows(frame))).toEqual([]);

    await expectHandedOver(page, frames);
});

test('a centred card that was dragged from under the stand-in is not turned into', async ({ mount, page }) => {
    // The picture is never answered: the handover waits its 1.2 s, which is the time to drag in.
    await page.route(`**${COVER_SERVED}`, () => {});
    const root = await mount('gridEntrancePerf', { firstCover: COVER_SERVED });
    await record(page, 3600);
    await open(root);
    // Taken by the card beside the centred one, and kept in the hand until the handover is over.
    await expect(page.locator('[data-folia-grid-item-id]').first()).toBeAttached();
    const { width, height } = page.viewportSize()!;
    await page.mouse.move(width / 2 + 300, height / 2);
    await page.mouse.down();
    await page.mouse.move(width / 2 + 180, height / 2, { steps: 6 });
    const { frames, heroCameAt, animated } = await read(page);
    await page.mouse.up();
    await page.unrouteAll({ behavior: 'ignoreErrors' });

    const fading = fadingOf(frames);
    // eslint-disable-next-line no-console
    console.log('DRAGGED AWAY', JSON.stringify({ fadeStartsAfterHeroCameMs: Math.round(fading[0]?.at - heroCameAt!), fadesForMs: Math.round(lengthOf(fading)), animated }));

    expectNoTurn(frames);
    // The hero is shown where it is, and the stand-in fades as it does over a hero (a stand-in
    // with no hero takes 260 ms).
    expect(fading.length).toBeGreaterThan(0);
    expect(fading.filter(frame => frame.heroOpacity !== 1)).toEqual([]);
    expect(lengthOf(fading)).toBeLessThanOrEqual(FADE_OVER_HERO_MS);
    expect(animated).toEqual(['opacity']);
    const last = frames[frames.length - 1];
    expect(last.standIn).toBeNull();
    expect(last.heroOpacity).toBe(1);
});

test('a page that has no cards lets its stand-in fade', async ({ mount, page }) => {
    const root = await mount('gridEntrancePerf', { tracksAtFirst: 0 });
    await record(page, 2000);
    await open(root);
    const { frames, landedAt, animated } = await read(page);

    const fading = fadingOf(frames);
    // eslint-disable-next-line no-console
    console.log('NO CARDS', JSON.stringify({ fadeAfterLandingMs: Math.round(fading[0]?.at - landedAt!), fadesForMs: Math.round(lengthOf(fading)), animated }));

    expect(frames.filter(frame => frame.hero !== null)).toEqual([]);
    expectNoTurn(frames);
    // Not before the flight has landed and its carrier has half dissolved.
    expect(fading[0].at).toBeGreaterThan(landedAt! + GIVES_WAY_AFTER_MS);
    expect(animated).toEqual(['opacity']);
    expect(frames[frames.length - 1].standIn).toBeNull();
    await expect(page.locator('[data-folia-morph-target]')).toHaveCount(0);
});

test('a turn under way is ended at once for whoever measures the centred card', async ({ mount, page }) => {
    const root = await mount('gridEntrancePerf', { firstCover: COVER_AT_ONCE });
    await open(root);
    // In the page, in the first frame that shows the turn under way (the stand-in part of the
    // way to edge-on, or the hero part of the way from it): measure the centred card as a host
    // does before it backs out.
    const measured = await page.evaluate(() => new Promise<{ angle: number; heroAngle: number; width: number | null; hero: string | null } | null>((resolve) => {
        const started = performance.now();
        const angleOf = (element: Element | null) => {
            const turned = element ? /(-?\d+(?:\.\d+)?(?:e-?\d+)?)deg/.exec(getComputedStyle(element).rotate) : null;
            return turned ? Math.abs(Number(turned[1])) : 0;
        };
        const look = () => {
            const standIn = document.querySelector('[data-folia-morph-target]')?.closest('[data-folia-morph-frame]') ?? null;
            const title = [...document.querySelectorAll('[data-folia-grid-item-id] [data-folia-card-title]')].find(line => line.textContent === 'Track 0');
            const hero = title?.closest('[data-folia-grid-item-id]')?.firstElementChild ?? null;
            const angle = angleOf(standIn);
            const heroAngle = angleOf(hero);
            // From 15 degrees on, where a card measures visibly narrower, to the end of the turn.
            if ((angle > 15 && angle < 90) || (heroAngle > 1 && heroAngle < 90)) {
                const card = (window as unknown as { __probeCentredCard: () => { rect: { width: number } } | null }).__probeCentredCard();
                resolve({ angle, heroAngle, width: card?.rect.width ?? null, hero: hero ? getComputedStyle(hero).rotate : null });
            } else if (performance.now() - started > 5000) {
                resolve(null);
            } else {
                requestAnimationFrame(look);
            }
        };
        requestAnimationFrame(look);
    }));
    // eslint-disable-next-line no-console
    console.log('MID-TURN', JSON.stringify(measured));

    expect(measured).not.toBeNull();
    // The card that is measured is the centred card, flat: its picture at its full width (a
    // card in mid-turn measures a sliver of it), and no turn left on it.
    expect(measured!.width).toBeGreaterThan(240);
    expect(['none', 'y 0deg']).toContain(measured!.hero);
    await expect(page.locator('[data-folia-morph-target]')).toHaveCount(0);
});

test('a stand-in that has not begun to give way is the card that is measured, and is left standing', async ({ mount, page }) => {
    // The picture is never answered: the handover waits for it, which is the time to measure in.
    await page.route(`**${COVER_SERVED}`, () => {});
    const root = await mount('gridEntrancePerf', { firstCover: COVER_SERVED });
    await open(root);
    // In the page, once the flight has landed with the hero there: measure the centred card.
    const measured = await page.evaluate(() => new Promise<{ width: number | null; standIn: string; hero: string } | null>((resolve) => {
        const started = performance.now();
        const look = () => {
            const standIn = document.querySelector('[data-folia-morph-target]')?.closest('[data-folia-morph-frame]') ?? null;
            const title = [...document.querySelectorAll('[data-folia-grid-item-id] [data-folia-card-title]')].find(line => line.textContent === 'Track 0');
            const hero = title?.closest('[data-folia-grid-item-id]')?.firstElementChild ?? null;
            const landed = (window as unknown as { __landedAt?: number }).__landedAt;
            if (standIn && hero && landed !== undefined && performance.now() - landed > 150) {
                const card = (window as unknown as { __probeCentredCard: () => { rect: { width: number } } | null }).__probeCentredCard();
                resolve({
                    width: card?.rect.width ?? null,
                    standIn: `${getComputedStyle(standIn).rotate} ${getComputedStyle(standIn).opacity}`,
                    hero: `${getComputedStyle(hero).rotate} ${getComputedStyle(hero).opacity}`,
                });
            } else if (performance.now() - started > 5000) {
                resolve(null);
            } else {
                requestAnimationFrame(look);
            }
        };
        requestAnimationFrame(look);
    }));
    // eslint-disable-next-line no-console
    console.log('MEASURED WHILE WAITING', JSON.stringify(measured));

    expect(measured).not.toBeNull();
    // The stand-in, whole; and measuring has ended nothing: it still stands, over a hero still held.
    expect(measured!.width).toBeGreaterThan(240);
    expect(measured!.standIn).toBe('none 1');
    expect(measured!.hero).toBe('none 0');
    // It gives way in its own time.
    await expect(page.locator('[data-folia-morph-target]')).toHaveCount(0, { timeout: 4000 });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
});

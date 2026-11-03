import { describe, expect, it } from 'vitest';
import { LOGIN_DONE, loginDoneFrame, loginDoneLanding, loginDonePlaying, loginDonePlays, type LoginDoneSince } from '@/components/login/done/loginDoneFrame';
import { platformShades } from '@/components/login/done/platformShades';
import { omni } from '@/services/onlineMusic/omni';
import { listOnlineMusicProviders } from '@/services/onlineMusic/providerRegistry';
import { getContrastRatio, getRelativeLuminance } from '@/utils/themeColorMath';

// test/unit/login/loginDoneFrame.test.ts
// The animation after a sign-in is one function of time: given how long ago the code was scanned,
// the phone confirmed and the account was read, it says what is drawn. Nobody can check its
// moments by looking once, so they are asked here; no test waits on a clock. The numbers are the
// approved mock-up's (u5-signin, paintTile / paintSheet / paintStage).

const NOT_YET: LoginDoneSince = { scan: null, confirm: null, read: null };
// A sign-in as the mock-up plays it: confirmed 1300 ms after the scan, the account read 2100 ms after it.
const at = (sinceScan: number, clock = 0) => loginDoneFrame({
    scan: sinceScan >= 0 ? sinceScan : null,
    confirm: sinceScan >= 1300 ? sinceScan - 1300 : null,
    read: sinceScan >= 2100 ? sinceScan - 2100 : null,
}, clock);
const afterRead = (ms: number) => at(2100 + ms);

describe('the animation after a sign-in, as a function of time', () => {
    it('draws nothing of itself before the code is scanned: the code stands as it is', () => {
        expect(loginDoneFrame(NOT_YET, 0)).toMatchObject({
            source: 1, cover: 0, disc: 0, phone: 0, person: 0, gather: 0, front: null, light: 0, tick: 0, leaving: false, flight: null, ended: false,
        });
        expect(loginDoneFrame(NOT_YET, 0).rings.map(ring => ring.opacity)).toEqual([0, 0]);
    });

    it('scan: the code fades in 110 ms, the colour grows over the tile in 420 ms, the phone and its disc are there at 460 ms', () => {
        expect(at(0)).toMatchObject({ source: 1, cover: 0, phone: 0 });
        expect(at(110).source).toBe(0);
        expect(at(150).cover).toBeGreaterThan(0.5);
        expect(at(150).cover).toBeLessThan(1);
        expect(at(420).cover).toBe(1);
        expect(at(200).phone).toBe(0);
        expect(at(460)).toMatchObject({ phone: 1, disc: 1, person: 0 });
        // The colour only ever grows.
        const covers = [0, 50, 100, 200, 300, 420, 900].map(ms => at(ms).cover);
        expect([...covers].sort((a, b) => a - b)).toEqual(covers);
    });

    it('waiting for the phone: two rings leave the glyph every 1.8 s, half a turn apart, fading as they go', () => {
        expect(at(450).rings.every(ring => ring.opacity === 0)).toBe(true);
        const [first, second] = at(900, 450).rings;
        // 450 ms into the 1.8 s: the first ring is a quarter of the way, the second three quarters.
        expect(first.opacity).toBeCloseTo(0.375);
        expect(second.opacity).toBeCloseTo(0.125);
        expect(second.at).toBeGreaterThan(first.at);
        expect(at(900, 450 + 1800).rings).toEqual(at(900, 450).rings);
    });

    it('confirmed: the phone and the rings give way to a person and one turning arc while the account is read', () => {
        expect(at(1300)).toMatchObject({ phone: 1, person: 0 });
        expect(at(1300 + 150, 300).rings.every(ring => ring.opacity === 0)).toBe(true);
        expect(at(1300 + 200).phone).toBe(0);
        expect(at(1300 + 400)).toMatchObject({ person: 1, disc: 1 });
        expect(at(1300 + 350, 1000).arc).toEqual({ opacity: 1, turn: 300 });
        expect(at(1300 + 350, 1400).arc.turn).toBe(60);
    });

    it('a sign-in with no "scanned" step grows the colour at the confirm and shows no phone and no rings', () => {
        const frame = (sinceConfirm: number) => loginDoneFrame({ scan: null, confirm: sinceConfirm, read: null }, 700);
        expect(frame(0)).toMatchObject({ source: 1, cover: 0 });
        expect(frame(420)).toMatchObject({ source: 0, cover: 1, phone: 0, person: 1 });
        // At no moment: the phone would come 200 ms after the scan, and by 200 ms after the confirm it has gone.
        for (const ms of [100, 200, 250, 330, 460, 700, 2000]) {
            expect(frame(ms).phone, `${ms} ms`).toBe(0);
            expect(frame(ms).rings.every(ring => ring.opacity === 0), `${ms} ms`).toBe(true);
        }
    });

    // A sign-in in the browser whose account is read in the same moment as the confirm: the colour
    // has 110 ms to cover the tile before it leaves it, not the 420 ms it takes by itself.
    it('has the colour over the whole tile when it leaves it, however soon the account is read, and gets there without a jump', () => {
        for (const readAfter of [0, 50, 150, 300, 420]) {
            const since = (ms: number) => loginDoneFrame({ scan: null, confirm: readAfter + ms, read: ms }, 0);
            expect(since(LOGIN_DONE.front).cover, `read ${readAfter} ms after the confirm`).toBe(1);
            // Millisecond by millisecond from the confirm to there: never back, never more than a small step.
            let before = 0;
            for (let ms = -readAfter; ms <= LOGIN_DONE.front; ms += 1) {
                const { cover } = loginDoneFrame({ scan: null, confirm: readAfter + ms, read: ms >= 0 ? ms : null }, 0);
                expect(cover - before, `read ${readAfter} ms after the confirm, at ${ms} ms`).toBeGreaterThanOrEqual(0);
                expect(cover - before).toBeLessThan(0.06);
                before = cover;
            }
        }
        // A sign-in whose colour had covered the tile long before draws as it did.
        expect(afterRead(0).cover).toBe(1);
    });

    // Whose picture is about to land in the switcher pill: the pill holds back only that platform's own.
    it('says whose picture is on its way: from the confirm to the end of the animation, in an open window with motion on', () => {
        const lands = (over: Partial<Parameters<typeof loginDoneLanding>[0]>) => loginDoneLanding({ open: true, still: false, confirmed: false, done: false, providerId: 'b', ...over });
        expect(lands({})).toBeNull();
        expect(lands({ confirmed: true })).toBe('b');
        expect(lands({ done: true })).toBe('b');
        // The window has left, the picture is still flying.
        expect(lands({ done: true, open: false })).toBe('b');
        // Closed while the account is read, motion off, or nothing chosen: no picture comes.
        expect(lands({ confirmed: true, open: false })).toBeNull();
        expect(lands({ confirmed: true, still: true })).toBeNull();
        expect(lands({ done: true, still: true })).toBeNull();
        expect(lands({ confirmed: true, providerId: null })).toBeNull();
    });

    it('account read: the tile gathers into a disc in 110 ms, what stood in it is gone at 140 ms, then the colour leaves the tile', () => {
        expect(afterRead(0)).toMatchObject({ gather: 0, front: null, person: 1 });
        expect(afterRead(109).front).toBeNull();
        expect(afterRead(LOGIN_DONE.front)).toMatchObject({ gather: 1, front: 0 });
        expect(afterRead(140)).toMatchObject({ person: 0, disc: 0, arc: { opacity: 0 } });
        expect(afterRead(340).front).toBeGreaterThan(0.4);
        expect(afterRead(570).front).toBe(1);
        // One soft light just behind the front, and none before it starts or after it has arrived.
        expect(afterRead(110).light).toBe(0);
        expect(afterRead(330).light).toBeCloseTo(0.16);
        expect(afterRead(570).light).toBe(0);
    });

    it('the picture lands from the tile\'s height, the two lines rise, the ring pings and the tick appears: all there after 740 ms', () => {
        expect(afterRead(200).picture).toEqual({ opacity: 0, lift: 1, scale: 1.2, settle: 0 });
        expect(afterRead(340).picture.opacity).toBe(1);
        expect(afterRead(640).picture).toEqual({ opacity: 1, lift: 0, scale: 1, settle: 1 });
        expect(afterRead(250)).toMatchObject({ line1: 0, line2: 0 });
        expect(afterRead(530).line1).toBe(1);
        expect(afterRead(530).line2).toBeLessThan(1);
        expect(afterRead(610).line2).toBe(1);
        expect(afterRead(520).ping.opacity).toBe(0);
        expect(afterRead(740).ping.opacity).toBeGreaterThan(0);
        expect(afterRead(960).ping).toEqual({ opacity: 0, scale: 1.7 });
        expect(afterRead(560).tick).toBe(0);
        expect(LOGIN_DONE.shown).toBe(740);
        expect(afterRead(LOGIN_DONE.shown)).toMatchObject({ tick: 1, line1: 1, line2: 1, words: 1, leaving: false, flight: null });
        expect(afterRead(940).watermark).toEqual({ opacity: 1, drift: 0 });
    });

    it('stands for 520 ms, then leaves: the words go in 140 ms and the picture travels for 480 ms, dropping before it glides', () => {
        expect(LOGIN_DONE.leave - LOGIN_DONE.shown).toBe(520);
        expect(afterRead(LOGIN_DONE.leave - 1)).toMatchObject({ leaving: false, flight: null, words: 1 });
        const start = afterRead(LOGIN_DONE.leave);
        expect(start.leaving).toBe(true);
        expect(start.flight).toEqual({ across: 0, down: 0, opacity: 1, ring: 1, mark: 0 });
        expect(afterRead(LOGIN_DONE.leave + 140).words).toBe(0);
        // Half-way through the flight it has dropped further than it has gone sideways.
        const half = afterRead(LOGIN_DONE.leave + 40 + 240).flight!;
        expect(half.across).toBeCloseTo(0.5);
        expect(half.down).toBeGreaterThan(0.7);
        const landed = afterRead(LOGIN_DONE.leave + 520).flight!;
        expect(landed).toMatchObject({ across: 1, down: 1, ring: 0, mark: 1 });
        expect(landed.opacity).toBeLessThan(1);
    });

    it('is over 1.8 s after the account was read, and a skip is the frame of that moment', () => {
        expect(LOGIN_DONE.end).toBe(1800);
        expect(afterRead(LOGIN_DONE.end - 1).ended).toBe(false);
        const end = afterRead(LOGIN_DONE.end);
        expect(end).toMatchObject({ ended: true, leaving: true, words: 0, flight: { across: 1, down: 1, opacity: 0 } });
        // Jumping to the end, from wherever it was: nothing is left to move.
        expect(loginDoneFrame({ scan: 9e9, confirm: 9e9, read: 9e9 }, 0)).toEqual(end);
    });

    it('does not play with motion off: reading the account is the end', () => {
        expect(loginDonePlays(true)).toBe(false);
        expect(loginDonePlays(false)).toBe(true);
    });

    // Whether the loop that draws it runs. The sign-in's state stays as it was when the window is
    // closed (it is cleared at the next opening), so the state alone does not say.
    it('is drawn only while there is something to draw: an open window after the scan, or the account read, until its own end', () => {
        const playing = (over: Partial<Parameters<typeof loginDonePlaying>[0]>) => loginDonePlaying({ open: true, still: false, scene: 'code', done: false, ...over });
        expect(playing({})).toBe(false);
        expect(playing({ scene: 'scanned' })).toBe(true);
        expect(playing({ scene: 'reading' })).toBe(true);
        // The window closed after the scan, or while the account is read: nothing plays.
        expect(playing({ scene: 'scanned', open: false })).toBe(false);
        expect(playing({ scene: 'reading', open: false })).toBe(false);
        // The account is read: it plays on after the window has left, the picture is still on its way.
        expect(playing({ scene: 'reading', done: true })).toBe(true);
        expect(playing({ scene: 'reading', done: true, open: false })).toBe(true);
        // A skip (the window closed, the animation told to end) stops it at once.
        expect(playing({ scene: 'reading', done: false, open: false })).toBe(false);
        // Motion switched off stops it wherever it was.
        for (const over of [{ scene: 'scanned' as const }, { scene: 'reading' as const, done: true }, { scene: 'reading' as const, done: true, open: false }]) {
            expect(playing({ ...over, still: true })).toBe(false);
        }
    });
});

describe('the colour that fills the window', () => {
    const colours = listOnlineMusicProviders().map(provider => omni.getProviderMark(provider.id)!.color);

    it('shades each platform\'s colour inside its own hue: a lighter end, a darker end, a deeper corner', () => {
        expect(colours.length).toBeGreaterThanOrEqual(6);
        for (const colour of colours) {
            const shades = platformShades(colour);
            expect(getRelativeLuminance(shades.light), colour).toBeGreaterThan(getRelativeLuminance(colour));
            expect(getRelativeLuminance(shades.dark), colour).toBeLessThan(getRelativeLuminance(colour));
            expect(shades.corner, colour).toMatch(/^rgba\(\d+, \d+, \d+, 0\.7\)$/);
            expect(shades.surface, colour).toContain(`linear-gradient(135deg, ${shades.light}, ${colour} 46%, ${shades.dark})`);
            // Plain colours only: nothing a browser without relative colours cannot read.
            expect(shades.surface, colour).not.toMatch(/oklch|from /);
        }
    });

    it('keeps the tick readable on its white disc: a bright colour is taken down, a dark one is left', () => {
        for (const colour of [...colours, '#facc15', '#a3e635']) expect(getContrastRatio(platformShades(colour).tick, '#ffffff'), colour).toBeGreaterThan(3);
        expect(getRelativeLuminance(platformShades('#facc15').tick)).toBeLessThan(getRelativeLuminance('#facc15'));
        expect(platformShades('#1d4ed8').tick).toBe('#1d4ed8');
    });

    it('uses a colour it cannot read as it is, without shades', () => {
        expect(platformShades('var(--st-t3)')).toEqual({ light: 'var(--st-t3)', dark: 'var(--st-t3)', corner: 'transparent', tick: 'var(--st-t3)', surface: 'var(--st-t3)' });
    });
});

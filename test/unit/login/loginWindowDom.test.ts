// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderAccountSummary } from '@/types/onlineMusic';

// test/unit/login/loginWindowDom.test.ts
// Four small rules of the sign-in window that live in its components, where the tests of
// loginHostState and loginDoneFrame do not reach: the window tells the animation whether it is
// open; the picture flies only to a switcher that shows the platform that signed in; the switcher
// holds its own picture back only for that platform; the row of platforms lets the wheel through
// at its ends. The components are drawn in jsdom: nothing is measured and nothing is timed.

const seen = vi.hoisted(() => ({ done: null as null | { playing: boolean; providerId: string | null } }));

vi.mock('@/services/onlineMusic/omni', () => ({
    omni: { getProviderLabel: (id: string) => id },
}));
vi.mock('@/components/modal/settings/kit/motion', async original => ({ ...(await original() as object), useKitReducedMotion: () => false }));
vi.mock('@/components/login/PlatformMark', () => ({
    AccountPicture: () => React.createElement('i', { 'data-picture': 'account' }),
    PlatformMark: () => React.createElement('i', { 'data-picture': 'mark' }),
    platformMarkOf: () => null,
}));
vi.mock('@/components/login/window/LoginWindow', () => ({ default: () => null }));
vi.mock('@/components/login/done/LoginDone', async original => ({
    ...(await original() as object),
    loginDoneColours: () => null,
    useLoginDone: (given: { playing: boolean; providerId: string | null }) => {
        seen.done = { playing: given.playing, providerId: given.providerId };
        return { current: {} };
    },
}));

import { loginDonePill } from '@/components/login/done/LoginDone';
import { LOGIN_DONE } from '@/components/login/done/loginDoneFrame';
import { useLoginWindowStore } from '@/components/login/loginWindowStore';
import SwitcherPill from '@/components/login/SwitcherPill';
import LoginScreen, { type LoginScreenProps } from '@/components/login/window/LoginScreen';
import PlatformColumn from '@/components/login/window/PlatformColumn';
import type { LibraryAccountController, LibraryLoginPhase } from '@/library/core/account/account.contract';

const row = (providerId: string, extra: Partial<ProviderAccountSummary> = {}): ProviderAccountSummary => ({
    providerId, shortName: providerId, displayName: providerId, availability: { configured: true }, status: 'anonymous', user: null, collections: [], ...extra,
});
const signedIn = (providerId: string) => row(providerId, { status: 'authenticated', user: { id: 1, nickname: 'someone' } });
// The pill reads the platforms and the one in use from the account controller: one that only shows them.
const accountShowing = (providers: ProviderAccountSummary[], activeProviderId: string): LibraryAccountController => {
    const snapshot = { providers, activeProviderId, login: null, pendingSwitch: null, logout: { providerId: null, status: 'idle' as const }, lastLoginCompletion: null };
    return { getSnapshot: () => snapshot, subscribe: () => () => { } } as unknown as LibraryAccountController;
};

describe('the sign-in window, drawn', () => {
    let root: Root;
    let place: HTMLElement;
    const draw = (element: React.ReactElement): void => act(() => root.render(element));

    beforeEach(() => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        // jsdom has neither of the two.
        (globalThis as { CSS?: unknown }).CSS ??= { escape: (text: string) => text };
        Element.prototype.scrollIntoView ??= () => { };
        place = document.body.appendChild(document.createElement('div'));
        root = createRoot(place);
        seen.done = null;
    });
    afterEach(() => {
        act(() => root.unmount());
        place.remove();
        vi.unstubAllGlobals();
        useLoginWindowStore.setState({ landing: null });
    });

    it('tells the animation after a scan to play only while the window is open, and which platform signs in', () => {
        const screen = (isOpen: boolean, phase: LibraryLoginPhase): React.ReactElement => React.createElement(LoginScreen, {
            isOpen, onClose: () => { }, rows: [row('a')], activeProviderId: null, chosen: { providerId: 'a', lead: 'sign-in' },
            login: {
                id: 1, providerId: 'a', phase, methods: [], selectedMethodId: null, inBrowser: false, codeImage: '', canReopenLoginPage: false,
                failure: null, selfCheck: null, localService: { available: false, failed: false, error: null, restarting: false }, texts: null,
            },
            onChoose: () => { }, onStart: () => { }, onSelectMethod: () => { }, onReopenBrowser: () => { }, onRestartService: () => { },
            onSwitch: () => { }, onSignOut: () => { }, buildReport: async () => '',
        } satisfies LoginScreenProps);
        draw(screen(true, 'scanned'));
        expect(seen.done).toEqual({ playing: true, providerId: 'a' });
        // The window was closed after the scan: the sign-in's state is still "scanned" until the next opening.
        draw(screen(false, 'scanned'));
        expect(seen.done).toEqual({ playing: false, providerId: 'a' });
        draw(screen(true, 'waiting'));
        expect(seen.done?.playing).toBe(false);
    });

    it('the switcher says which platform it shows, and the picture flies only to that one', () => {
        const pill = (active: string): React.ReactElement => React.createElement(SwitcherPill, { account: accountShowing([signedIn('a'), signedIn('b')], active), onBackToPlayer: () => { } });
        expect(loginDonePill('a')).toBeNull();
        draw(pill('a'));
        expect(loginDonePill('a')).toBe(place.querySelector('[data-login-pill]'));
        // Signed in to b, the switch to it declined: the switcher still shows a.
        expect(loginDonePill('b')).toBeNull();
        draw(pill('b'));
        expect(loginDonePill('b')).toBe(place.querySelector('[data-login-pill]'));
        expect(loginDonePill('a')).toBeNull();
    });

    // The real useLoginDone (this file hands the window a stand-in), its frames called by hand with a made-up clock.
    it('the picture flies to a switcher that shows the platform that signed in, to no other, and the window leaves either way', async () => {
        const { useLoginDone } = await vi.importActual<typeof import('@/components/login/done/LoginDone')>('@/components/login/done/LoginDone');
        const frames: FrameRequestCallback[] = [];
        vi.stubGlobal('requestAnimationFrame', (step: FrameRequestCallback) => frames.push(step));
        vi.stubGlobal('cancelAnimationFrame', () => { });
        // jsdom lays nothing out: every element of the animation and the switcher's picture get a box of some size.
        const sized = (): HTMLElement => Object.assign(document.createElement('div'), { getBoundingClientRect: () => ({ left: 10, top: 10, width: 40, height: 40 }) as DOMRect });
        const pill = document.body.appendChild(sized());

        // Signs in to b while the switcher shows `shown`; answers whether the flying picture was drawn when the window was told to leave.
        const flewTo = (shown: string): boolean => {
            pill.dataset.loginPill = shown;
            const drawn = { tile: sized(), flood: sized(), picture: sized(), flight: sized() };
            const onLeave = vi.fn();
            const Player = (): null => {
                const parts = useLoginDone({ playing: true, providerId: 'b', scanned: true, confirmed: true, read: true, onLeave, onEnd: () => { } });
                Object.assign(parts.current, drawn);
                return null;
            };
            draw(React.createElement(Player));
            const start = performance.now();
            // One frame after the colour has left the tile (the window is measured), one after the window is to leave.
            for (const since of [LOGIN_DONE.front + 100, LOGIN_DONE.leave + 100]) frames.shift()!(start + since);
            expect(onLeave).toHaveBeenCalledTimes(1);
            draw(React.createElement('i'));
            frames.length = 0;
            return drawn.flight.style.visibility === 'visible';
        };
        const flew = { shown: flewTo('b'), other: flewTo('a') };
        pill.remove();
        // The other: signed in to b, the switch to it declined, the switcher still shows a.
        expect(flew).toEqual({ shown: true, other: false });
    });

    it('the switcher holds its picture back only while the picture of the platform it shows is on its way', () => {
        draw(React.createElement(SwitcherPill, { account: accountShowing([signedIn('a'), signedIn('b')], 'a'), onBackToPlayer: () => { } }));
        const picture = place.querySelector<HTMLElement>('[data-login-pill]')!;
        expect(picture.style.opacity).toBe('');
        act(() => useLoginWindowStore.setState({ landing: 'b' }));
        expect(picture.style.opacity).toBe('');
        act(() => useLoginWindowStore.setState({ landing: 'a' }));
        expect(picture.style.opacity).toBe('0');
        act(() => useLoginWindowStore.setState({ landing: null }));
        expect(picture.style.opacity).toBe('');
    });

    it('the row of platforms takes the wheel to move sideways, and lets it through at either end', () => {
        draw(React.createElement(PlatformColumn, { rows: [row('a'), row('b'), row('c')], chosenId: 'a', onChoose: () => { }, lie: 'row' }));
        const list = place.querySelector<HTMLElement>('[role="listbox"]')!;
        // A row 300 wide in a window 100 wide: 200 to scroll.
        Object.defineProperty(list, 'scrollWidth', { value: 300 });
        Object.defineProperty(list, 'clientWidth', { value: 100 });
        const wheel = (deltaY: number, deltaX = 0): boolean => {
            const event = new WheelEvent('wheel', { deltaY, deltaX, cancelable: true, bubbles: true });
            list.dispatchEvent(event);
            return event.defaultPrevented;
        };
        list.scrollLeft = 0;
        expect(wheel(-40)).toBe(false);
        expect(wheel(40)).toBe(true);
        expect(list.scrollLeft).toBe(40);
        expect(wheel(-40)).toBe(true);
        expect(list.scrollLeft).toBe(0);
        list.scrollLeft = 200;
        expect(wheel(40)).toBe(false);
        expect(list.scrollLeft).toBe(200);
        // A sideways wheel is the list's own: nothing is taken over.
        list.scrollLeft = 100;
        expect(wheel(0, 40)).toBe(false);
        expect(wheel(40, 40)).toBe(false);
    });
});

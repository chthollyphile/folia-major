// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stores read localStorage at import time; see foliumUiRegistries.test.ts.
const storage = vi.hoisted(() => {
    const items = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => items.get(key) ?? null,
            setItem: (key: string, value: string) => { items.set(key, String(value)); },
            removeItem: (key: string) => { items.delete(key); },
            clear: () => items.clear(),
            key: (index: number) => Array.from(items.keys())[index] ?? null,
            get length() { return items.size; },
        },
    });
    return items;
});

// The sheet is drawn in a layer of the app shell; here it is only its header actions and its content, in place.
vi.mock('@/components/shared/Sheet', () => ({
    default: ({ headerActions, children }: { headerActions?: React.ReactNode; children?: React.ReactNode }) => (
        React.createElement('div', null, headerActions, children)
    ),
}));

import i18n from '@/i18n/config';
import AudioEqualizerDialog from '@/components/panelTab/AudioEqualizerDialog';
import { AUDIO_EQUALIZER_MOD_CURVE_KEY, useAudioSettingsStore } from '@/stores/useAudioSettingsStore';
import { AUDIO_EQUALIZER_STORAGE_KEY, resolveAudioEqualizerSettings, type AudioEqualizerSettings } from '@/utils/audioEqualizer';
import { normalizeAudioEffects } from '@/utils/audioEffects';

// test/unit/player-panel/audioEqualizerDialog.test.ts
// The audio effects window under a mod's equalizer curve (Folium 1.7): the bands and effects are
// read-only, so no commit of theirs writes the curve into a custom slot; the switch flips only itself; the
// notice saves the curve into the one slot asked for, or goes back to the listener's own sound. A curve on
// hold leaves the window the listener's own. And a window that goes away closes the open flag, a microtask
// later, so StrictMode's trial unmount does not close it. Drawn in jsdom with the real store.

const initial = useAudioSettingsStore.getState();
const store = () => useAudioSettingsStore.getState();
const SMILE = [4, 3, 1, 0, -1, -1, 0, 1, 3, 4];

const ownSound = (): AudioEqualizerSettings => resolveAudioEqualizerSettings({
    enabled: true,
    preset: 'custom1',
    gains: [2, 2, 1, 0, 0, 0, 0, 1, 2, 2],
    effects: normalizeAudioEffects({ width: 1.2 }),
    customSlots: [
        { gains: [2, 2, 1, 0, 0, 0, 0, 1, 2, 2], effects: normalizeAudioEffects({ width: 1.2 }) },
        { gains: [-3, -3, 0, 0, 0, 0, 0, 0, -3, -3], effects: normalizeAudioEffects({ space: 0.3 }) },
    ],
});

const flush = () => new Promise<void>((resolve) => { queueMicrotask(resolve); });

describe('the audio effects window', () => {
    let root: Root;
    let place: HTMLElement;
    const draw = (element: React.ReactElement = React.createElement(AudioEqualizerDialog, { isDaylight: false })) => {
        act(() => root.render(element));
    };
    const buttonNamed = (text: string): HTMLButtonElement => {
        const found = Array.from(place.querySelectorAll('button')).find((button) => button.textContent === text);
        if (!found) throw new Error(`no button "${text}"`);
        return found;
    };
    const sliders = () => Array.from(place.querySelectorAll<HTMLElement>('[role="slider"]'));
    const press = (element: Element) => act(() => {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    beforeEach(() => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        useAudioSettingsStore.setState(initial, true);
        storage.clear();
        useAudioSettingsStore.setState({ audioEqualizerSettings: ownSound() });
        storage.set(AUDIO_EQUALIZER_STORAGE_KEY, JSON.stringify(ownSound()));
        store().openAudioEqualizer();
        place = document.body.appendChild(document.createElement('div'));
        root = createRoot(place);
    });

    afterEach(() => {
        act(() => root.unmount());
        place.remove();
    });

    describe('under a mod\'s curve', () => {
        beforeEach(() => {
            store().handleApplyModEqualizerCurve({ modId: 'eq-mod', modName: 'EQ mod', gains: SMILE });
            draw();
        });

        it('says whose curve it is, lights no preset and shows the curve on the faders', () => {
            expect(place.textContent).toContain(i18n.t('ui.equalizerModCurve', { name: 'EQ mod' }));
            expect(place.querySelectorAll('[aria-pressed="true"]')).toHaveLength(0);
            expect(sliders().slice(0, 10).map((slider) => Number(slider.getAttribute('aria-valuenow')))).toEqual(SMILE);
        });

        it('keeps the bands and the effects out of reach, and their commits write nothing', () => {
            const all = sliders();
            // Ten faders, then the effect sliders: every one of them sits in the inert part.
            expect(all.length).toBeGreaterThan(10);
            all.forEach((slider) => expect(slider.closest('[inert]')).not.toBeNull());
            const settingsBytes = storage.get(AUDIO_EQUALIZER_STORAGE_KEY);
            const sets = vi.fn();
            const stop = useAudioSettingsStore.subscribe(sets);

            // jsdom does not keep events away from an inert part: send what a key and a focus change would.
            for (const slider of [all[0], all[10]]) {
                act(() => {
                    slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
                    slider.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowUp', bubbles: true }));
                    slider.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
                });
            }

            stop();
            // No commit reached the store: handleSetAudioEqualizerSettings would have set it and ended the curve.
            expect(sets).not.toHaveBeenCalled();
            expect(storage.get(AUDIO_EQUALIZER_STORAGE_KEY)).toBe(settingsBytes);
            expect(store().audioEqualizerModCurve).toMatchObject({ modId: 'eq-mod', gains: SMILE });
        });

        it('leaves the band strip scrollable sideways: only the faders are out of reach', () => {
            // A narrow window scrolls the ten bands sideways; an inert strip would take no wheel, swipe or bar drag.
            const strip = sliders()[0].closest('.overflow-x-auto');
            expect(strip).not.toBeNull();
            expect(strip!.closest('[inert]')).toBeNull();
            expect(sliders()[0].closest('[inert]')).not.toBeNull();
        });

        it('flips only the switch, and the curve stays', () => {
            press(place.querySelector('[role="switch"]')!);
            expect(store().audioEqualizerSettings).toEqual({ ...ownSound(), enabled: false });
            expect(store().audioEqualizerModCurve).toMatchObject({ modId: 'eq-mod', gains: SMILE });
        });

        it('saves the curve into custom 2 and nothing else, and plays it from there', () => {
            press(buttonNamed(i18n.t('ui.equalizerModCurveSave', { slot: i18n.t('ui.equalizerPreset.custom2') })));
            const settings = store().audioEqualizerSettings;
            expect(settings.customSlots[0]).toEqual(ownSound().customSlots[0]);
            expect(settings.customSlots[1]).toEqual({ gains: SMILE, effects: ownSound().effects });
            expect(settings.preset).toBe('custom2');
            expect(store().audioEqualizerModCurve).toBeNull();
            expect(storage.has(AUDIO_EQUALIZER_MOD_CURVE_KEY)).toBe(false);
        });

        it('goes back to the listener\'s own sound as it was', () => {
            press(buttonNamed(i18n.t('ui.equalizerModCurveRelease')));
            expect(store().audioEqualizerSettings).toEqual(ownSound());
            expect(store().audioEqualizerModCurve).toBeNull();
            expect(place.textContent).not.toContain(i18n.t('ui.equalizerModCurve', { name: 'EQ mod' }));
        });
    });

    it('leaves the window the listener\'s own while the curve is on hold', () => {
        store().handleApplyModEqualizerCurve({ modId: 'eq-mod', modName: 'EQ mod', gains: SMILE });
        store().handleSetAudioEqualizerModCurveSuspended(true);
        draw();

        expect(place.textContent).toContain(i18n.t('ui.equalizerModCurveDormant', { name: 'EQ mod' }));
        expect(buttonNamed(i18n.t('ui.equalizerModCurveDiscard'))).toBeTruthy();
        sliders().forEach((slider) => expect(slider.closest('[inert]')).toBeNull());
        const lit = Array.from(place.querySelectorAll('[aria-pressed="true"]')).map((chip) => chip.textContent);
        expect(lit).toEqual([i18n.t('ui.equalizerPreset.custom1')]);
        expect(sliders().slice(0, 10).map((slider) => Number(slider.getAttribute('aria-valuenow')))).toEqual(ownSound().gains);

        press(buttonNamed(i18n.t('ui.equalizerModCurveDiscard')));
        expect(store().audioEqualizerModCurve).toBeNull();
        expect(store().audioEqualizerSettings).toEqual(ownSound());
    });

    it('keeps a curve on hold through a fader or an effect let go with nothing edited', () => {
        store().handleApplyModEqualizerCurve({ modId: 'eq-mod', modName: 'EQ mod', gains: SMILE });
        store().handleSetAudioEqualizerModCurveSuspended(true);
        draw();
        const all = sliders();
        const settingsBytes = storage.get(AUDIO_EQUALIZER_STORAGE_KEY);

        // Tabbing through a slider, and a press on its thumb that does not move it: each lets go of nothing.
        for (const slider of [all[0], all[10]]) {
            act(() => {
                slider.dispatchEvent(new KeyboardEvent('keyup', { key: 'Tab', bubbles: true }));
                slider.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
                slider.dispatchEvent(new Event('lostpointercapture', { bubbles: true }));
            });
        }

        expect(store().audioEqualizerModCurve).toMatchObject({ modId: 'eq-mod', gains: SMILE });
        expect(storage.has(AUDIO_EQUALIZER_MOD_CURVE_KEY)).toBe(true);
        expect(storage.get(AUDIO_EQUALIZER_STORAGE_KEY)).toBe(settingsBytes);
        expect(place.textContent).toContain(i18n.t('ui.equalizerModCurveDormant', { name: 'EQ mod' }));
    });

    it('lets an edit of the listener\'s own sound discard a curve on hold', () => {
        store().handleApplyModEqualizerCurve({ modId: 'eq-mod', modName: 'EQ mod', gains: SMILE });
        store().handleSetAudioEqualizerModCurveSuspended(true);
        draw();
        const fader = sliders()[0];

        act(() => {
            fader.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
            fader.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowUp', bubbles: true }));
        });

        expect(store().audioEqualizerSettings.gains[0]).toBe(ownSound().gains[0] + 1);
        expect(store().audioEqualizerSettings.preset).toBe('custom1');
        expect(store().audioEqualizerModCurve).toBeNull();
        expect(storage.has(AUDIO_EQUALIZER_MOD_CURVE_KEY)).toBe(false);
    });

    it('shows no notice without a curve', () => {
        draw();
        expect(place.textContent).not.toContain(i18n.t('ui.equalizerModCurveRelease'));
        sliders().forEach((slider) => expect(slider.closest('[inert]')).toBeNull());
    });

    it('closes the open flag a microtask after it goes away', async () => {
        draw();
        expect(store().isAudioEqualizerOpen).toBe(true);
        act(() => root.unmount());
        root = createRoot(place);
        expect(store().isAudioEqualizerOpen).toBe(true);
        await flush();
        expect(store().isAudioEqualizerOpen).toBe(false);
    });

    it('stays open through StrictMode\'s trial unmount', async () => {
        draw(React.createElement(React.StrictMode, null, React.createElement(AudioEqualizerDialog, { isDaylight: false })));
        await flush();
        await flush();
        expect(store().isAudioEqualizerOpen).toBe(true);
    });
});

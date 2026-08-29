import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Statically, so the (large) module graph behind stems.ts is paid during collection rather than
// inside a test's timeout - under a full run it is slow enough to trip the 5s default.
import {
    modelsPresent,
    refreshModelAvailability,
    subscribeModelAvailability,
} from '@/services/automix/modelAvailability';
import { transitionCapabilities } from '@/services/automix/stems';

// test/unit/automix/modelAvailability.test.ts
// The capability answer has to distinguish "this is the browser" from "the weights are not
// downloaded yet". For most of this feature's life those were the same situation, so the check was
// `typeof window.electron.separateStems === 'function'` - which on a desktop install with an empty
// models directory says the full engine is running, greys nothing out, and only tells the truth
// after a track has already fallen back. Once the weights are an optional download that is not an
// edge case, it is the state most installs start in.
//
// The suite runs on the node environment, so `window` is stood up by hand - the same way the other
// tests in this repo that need one do it. It is deliberately absent at import time, which is the
// browser build's situation and the one the module graph is already known to load under.

const bridge = {
    runBeatThis: vi.fn(),
    separateStems: vi.fn(),
    getAutomixModelsPresent: vi.fn(),
};

const host = globalThis as { window?: object };
const setBridge = (electron?: unknown) => {
    host.window = electron === undefined ? {} : { electron };
};

const installed = (beat_this: boolean, htdemucs: boolean) => {
    bridge.getAutomixModelsPresent.mockResolvedValue({ beat_this, htdemucs });
    return refreshModelAvailability();
};

describe('which models are installed', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        setBridge(bridge);
        await installed(true, true);
    });

    afterEach(() => {
        delete host.window;
    });

    it('is the full engine when the bridge and both files are there', () => {
        expect(transitionCapabilities()).toMatchObject({
            beatGrid: true, stems: true, full: true, desktop: true,
        });
    });

    // The bug. A desktop build with nothing downloaded used to report the full engine.
    it('is not the full engine on a desktop build with no weights', async () => {
        await installed(false, false);
        expect(transitionCapabilities()).toMatchObject({ beatGrid: false, stems: false, full: false });
        // Still desktop, which is what lets the page say "not downloaded" rather than "your browser
        // cannot do this" - the two need different words because only one of them is actionable.
        expect(transitionCapabilities().desktop).toBe(true);
    });

    // The models are downloaded separately and are worth 83MB and 166MB, so having one is a real
    // state rather than a transient: better bar lines, no stem gesture.
    it('reports the two models independently', async () => {
        await installed(true, false);
        expect(transitionCapabilities()).toMatchObject({ beatGrid: true, stems: false, full: false });
    });

    it('is the browser build when there is no bridge at all', () => {
        setBridge(undefined);
        expect(transitionCapabilities()).toMatchObject({ full: false, desktop: false });
    });

    it('keeps the last answer when the check fails rather than downgrading the build', async () => {
        expect(modelsPresent().htdemucs).toBe(true);

        bridge.getAutomixModelsPresent.mockRejectedValue(new Error('main process went away'));
        await refreshModelAvailability();
        expect(modelsPresent().htdemucs).toBe(true);
    });

    // What lets it be a useSyncExternalStore snapshot: an unchanged answer must be the same object,
    // or every refresh re-renders the settings page.
    it('returns the same object when nothing changed, and a new one when it did', async () => {
        const before = modelsPresent();
        await installed(true, true);
        expect(modelsPresent()).toBe(before);

        await installed(true, false);
        expect(modelsPresent()).not.toBe(before);
        expect(modelsPresent().htdemucs).toBe(false);
    });

    // A download finishing has to be visible without a restart - that is the whole reason "no
    // weights" was taken out of the session-long declined latch.
    it('notices a model that arrives while the app is running', async () => {
        await installed(false, false);
        expect(transitionCapabilities().full).toBe(false);

        await installed(true, true);
        expect(transitionCapabilities().full).toBe(true);
    });

    it('tells its subscribers when the answer changes, and only then', async () => {
        const listener = vi.fn();
        const unsubscribe = subscribeModelAvailability(listener);

        await installed(true, true);
        expect(listener).not.toHaveBeenCalled();

        await installed(false, true);
        expect(listener).toHaveBeenCalledTimes(1);

        unsubscribe();
        await installed(true, true);
        expect(listener).toHaveBeenCalledTimes(1);
    });
});

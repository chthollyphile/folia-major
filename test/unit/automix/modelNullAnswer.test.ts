import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Imported statically as well as dynamically below, for the reason modelAvailability.test.ts
// gives: transforming the module graph behind stems.ts takes longer than a test's 5s timeout
// under a full run, and doing it here pays it during collection instead. The dynamic imports
// then only re-instantiate, which is what a fresh module state needs and is fast.
import '@/services/automix/stems';

// test/unit/automix/modelNullAnswer.test.ts
// What a null answer from the worker is allowed to mean.
//
// For a long time an empty answer with the weights present was read as "this runtime will not
// start" and latched the model off for the whole session. That was safe only while the weights
// shipped inside the installer, where a present-but-empty run had no other explanation. Once the
// weights became an optional download it stopped being safe: the host restarts the worker on every
// folder switch and every finished download, and an in-flight request that gets cut off by one of
// those comes back with the same nothing. A listener who had models in a custom folder, deleted
// them, switched back to the default and re-downloaded found the model never called again until
// relaunch - one transient null had latched the session off, and no download could undo it.
//
// So there is no latch now. A null only re-checks what is on disk. A model is runnable exactly when
// its weights are present; the worker keeps its own per-process guard against re-initialising a
// runtime that genuinely failed, which needs nothing from here.
//
// Every test re-imports the modules, because the on-disk answer is module state.

const bridge = {
    runBeatThis: vi.fn(),
    separateStems: vi.fn(),
    getAutomixModelsPresent: vi.fn(),
};

// A `window` is stood up by hand, the way the other suites here that need one do it. It has to
// carry a localStorage: stems.ts pulls in the i18n config, which reads the stored language as soon
// as it sees a window, and these tests import it with one already installed.
const host = globalThis as { window?: object; localStorage?: object };
const noStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

/** Long enough to be split into chunks. The contents never reach a model here. */
const mel = { data: new Float32Array(300 * 128), frames: 300 };

const onDisk = (beat_this: boolean, htdemucs: boolean) => {
    bridge.getAutomixModelsPresent.mockResolvedValue({ beat_this, htdemucs });
};

const freshModules = async () => {
    vi.resetModules();
    const availability = await import('@/services/automix/modelAvailability');
    const beatThis = await import('@/services/automix/beatThis');
    const stems = await import('@/services/automix/stems');
    // The module asks once as it loads; wait for that answer rather than racing it.
    await availability.refreshModelAvailability();
    return { availability, beatThis, stems };
};

describe('a model run that comes back with nothing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        host.localStorage = noStorage;
        host.window = { electron: bridge, localStorage: noStorage };
        onDisk(true, true);
    });

    afterEach(() => {
        delete host.window;
        delete host.localStorage;
    });

    // The bug, on the beat grid: a null with the weights gone follows disk down and back up, never
    // sticking.
    it('follows the weights off disk and back, on the beat grid', async () => {
        const { availability, beatThis } = await freshModules();
        expect(beatThis.canRunBeatThis()).toBe(true);

        // The weights go while the request is in flight, so it answers null.
        onDisk(false, false);
        bridge.runBeatThis.mockResolvedValue(null);
        expect(await beatThis.analyseBeatGrid(mel)).toBeNull();
        expect(beatThis.canRunBeatThis()).toBe(false);

        // Downloaded again. This is the line that used to stay false until a restart.
        onDisk(true, true);
        await availability.refreshModelAvailability();
        expect(beatThis.canRunBeatThis()).toBe(true);
    });

    // The same on the separator, where the window is far wider: separation is asked for the instant
    // a track starts and runs for tens of seconds, so a deletion landing inside one is ordinary.
    it('follows the weights off disk and back, on the separator', async () => {
        const { availability, stems } = await freshModules();
        expect(stems.canSeparateStems()).toBe(true);

        onDisk(false, false);
        await availability.noteModelFailed('htdemucs');
        expect(stems.canSeparateStems()).toBe(false);

        onDisk(true, true);
        await availability.refreshModelAvailability();
        expect(stems.canSeparateStems()).toBe(true);
    });

    // The case that used to latch and must not: an empty answer with the weights still present is a
    // worker restarted under the request (a folder switch, a finished download), not a dead runtime.
    // The model stays runnable and is simply asked again next time.
    it('keeps the model runnable when a null arrives with the weights present', async () => {
        const { availability, beatThis } = await freshModules();

        bridge.runBeatThis.mockResolvedValue(null);
        expect(await beatThis.analyseBeatGrid(mel)).toBeNull();
        expect(beatThis.canRunBeatThis()).toBe(true);

        await availability.refreshModelAvailability();
        expect(beatThis.canRunBeatThis()).toBe(true);
        expect(availability.modelsPresent().beat_this).toBe(true);
    });

    // A malformed answer is the same story: it is a bug in this code rather than a missing file, but
    // there is no longer any state to poison - it falls back this time and is asked again next time.
    it('keeps the model runnable when the answer came back malformed', async () => {
        const { beatThis } = await freshModules();

        bridge.runBeatThis.mockResolvedValue({ beat: [], downbeat: [] });
        expect(await beatThis.analyseBeatGrid(mel)).toBeNull();
        expect(beatThis.canRunBeatThis()).toBe(true);
    });

    // One model's empty answer must not touch the other: separate files, downloads, runtimes.
    it('leaves the other model alone', async () => {
        const { beatThis, stems } = await freshModules();

        bridge.runBeatThis.mockResolvedValue(null);
        await beatThis.analyseBeatGrid(mel);
        expect(stems.canSeparateStems()).toBe(true);
    });

    // A failure over missing weights means this module's answer was already wrong, and the engine
    // badge is drawn from it - so the failure corrects it rather than only declining to latch.
    it('corrects what the rest of the app believes is on disk', async () => {
        const { availability, stems } = await freshModules();
        expect(stems.transitionCapabilities().full).toBe(true);

        onDisk(false, false);
        await availability.noteModelFailed('htdemucs');
        expect(availability.modelsPresent().htdemucs).toBe(false);
        expect(stems.transitionCapabilities()).toMatchObject({ stems: false, full: false, desktop: true });
    });
});

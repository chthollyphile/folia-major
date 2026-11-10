import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/hooks/useLyricApiPublisher.test.ts
// The lyric API publisher sends where a preview clip starts with the lyrics, and sends again when the
// address changes. Vitest runs in node without a renderer, so a small stand-in for React keeps state
// and runs an effect when its dependencies change, which is all this hook uses.

const react = vi.hoisted(() => {
    type Effect = { deps: unknown[] | undefined; cleanup?: (() => void) | void };
    const state = { slots: [] as unknown[], effects: [] as Effect[], slot: 0, effect: 0 };
    const pending: Array<() => void> = [];
    return {
        state,
        pending,
        reset() {
            state.slots = [];
            state.effects.forEach(effect => typeof effect.cleanup === 'function' && effect.cleanup());
            state.effects = [];
        },
        begin() {
            state.slot = 0;
            state.effect = 0;
        },
        flush() {
            pending.splice(0).forEach(run => run());
        },
        module: {
            useState<T>(initial: T | (() => T)) {
                const index = state.slot++;
                if (!(index in state.slots)) {
                    state.slots[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
                }
                const set = (next: T) => { state.slots[index] = next; };
                return [state.slots[index] as T, set] as const;
            },
            useMemo<T>(factory: () => T) {
                return factory();
            },
            useCallback<T>(callback: T) {
                return callback;
            },
            useEffect(run: () => (() => void) | void, deps?: unknown[]) {
                const index = state.effect++;
                const previous = state.effects[index];
                const changed = !previous || !deps || !previous.deps
                    || deps.some((value, at) => !Object.is(value, previous.deps?.[at]));
                if (!changed) return;
                pending.push(() => {
                    if (previous && typeof previous.cleanup === 'function') previous.cleanup();
                    state.effects[index] = { deps, cleanup: run() };
                });
                if (!previous) state.effects[index] = { deps };
                else state.effects[index] = { ...previous, deps };
            },
        },
    };
});
vi.mock('react', () => react.module);

const clipStarts = vi.hoisted(() => new Map<string, number>());
vi.mock('../../../src/services/onlineMusic/omni', () => ({
    omni: { previewClipStartMsOfAudioSource: (url: string) => clipStarts.get(url) ?? 0 },
}));

const { useLyricApiPublisher } = await import('../../../src/hooks/useLyricApiPublisher');

const LYRICS = { lines: [{ fullText: 'Line', startTime: 70.5, endTime: 74.8, words: [] }] } as never;
const OTHER_LYRICS = { lines: [{ fullText: 'Other', startTime: 1, endTime: 2, words: [] }] } as never;
const PREVIEW = 'https://cdn.example/preview.mp3';
const WHOLE = 'https://cdn.example/whole.mp3';

const publish = vi.fn((..._args: unknown[]) => Promise.resolve(true));
const enabledStatus = { enabled: true, running: true, port: 32109, url: 'http://127.0.0.1:32109/v1/lyric', error: null };

const render = (props: { lyrics?: unknown; offset?: number; audioSrc: string | null }) => {
    react.begin();
    useLyricApiPublisher({
        isElectronWindow: true,
        lyrics: (props.lyrics ?? LYRICS) as never,
        offset: props.offset ?? -250,
        audioSrc: props.audioSrc,
    });
    react.flush();
};

beforeEach(() => {
    react.reset();
    publish.mockClear();
    clipStarts.clear();
    clipStarts.set(PREVIEW, 64319);
    (globalThis as { window?: unknown }).window = {
        electron: {
            getLyricApiStatus: () => Promise.resolve(enabledStatus),
            onLyricApiStatusChanged: () => () => {},
            publishLyricApiData: publish,
        },
    };
    // The first render reads the status; the API is on from the start.
    react.state.slots[0] = enabledStatus;
});

afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
});

describe('useLyricApiPublisher', () => {
    it('sends where the preview clip starts along with the lyrics and the manual offset', () => {
        render({ audioSrc: PREVIEW });
        expect(publish).toHaveBeenLastCalledWith(LYRICS, -250, 64319);
    });

    it('sends again when the address changes, even with the same lyrics and offset', () => {
        render({ audioSrc: PREVIEW });
        expect(publish).toHaveBeenCalledTimes(1);

        render({ audioSrc: WHOLE });
        expect(publish).toHaveBeenCalledTimes(2);
        expect(publish).toHaveBeenLastCalledWith(LYRICS, -250, 0);
    });

    it('does not send again when nothing it sends has changed', () => {
        render({ audioSrc: PREVIEW });
        render({ audioSrc: PREVIEW });
        expect(publish).toHaveBeenCalledTimes(1);

        render({ audioSrc: PREVIEW, lyrics: OTHER_LYRICS });
        expect(publish).toHaveBeenCalledTimes(2);
        expect(publish).toHaveBeenLastCalledWith(OTHER_LYRICS, -250, 64319);
    });

    it('sends 0 for a whole song and while no address is loaded', () => {
        render({ audioSrc: null });
        expect(publish).toHaveBeenLastCalledWith(LYRICS, -250, 0);
        render({ audioSrc: WHOLE });
        expect(publish).toHaveBeenLastCalledWith(LYRICS, -250, 0);
    });

    it('sends nothing while the API is off', () => {
        react.state.slots[0] = { ...enabledStatus, enabled: false, running: false, url: null };
        render({ audioSrc: PREVIEW });
        expect(publish).not.toHaveBeenCalled();
    });
});

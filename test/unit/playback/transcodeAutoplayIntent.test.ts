import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusMessage } from '../../../src/types';

// test/unit/playback/transcodeAutoplayIntent.test.ts
// 仓库的 vitest 跑在 node 环境，没有 jsdom，也没有 testing-library：按 usePersonalFmModeController
// 的做法就地复刻 useRef/useEffect/useCallback，直接驱动 usePlaybackAudioBridge 的真实实现，
// 只断言自动播放 effect 对「这一路 source 已经失败、转码正在进行中」的处理。
// 另断言起播成功时收起残留的「重试 / 跳过」失败提示（transport 刷新后的音源由这里起播）。

const reactHooks = vi.hoisted(() => {
    const refs: { current: unknown }[] = [];
    const effects: Array<() => unknown> = [];
    let cursor = 0;
    return {
        refs,
        effects,
        startRender() {
            cursor = 0;
            effects.length = 0;
        },
        useRef(initial: unknown) {
            refs[cursor] ??= { current: initial };
            return refs[cursor++];
        },
        flush() {
            effects.forEach(effect => { effect(); });
        },
    };
});

vi.mock('react', () => ({
    useCallback: (callback: unknown) => callback,
    useMemo: (factory: () => unknown) => factory(),
    useRef: (initial: unknown) => reactHooks.useRef(initial),
    useEffect: (effect: () => unknown) => { reactHooks.effects.push(effect); },
}));

const playbackState = vi.hoisted(() => ({
    audioSrc: null as string | null,
    currentSong: null,
    replayGainMode: 'off',
}));
const setPlayerStateMock = vi.hoisted(() => vi.fn());
vi.mock('../../../src/stores/usePlaybackStore', () => ({
    usePlaybackStore: (selector: (state: typeof playbackState) => unknown) => selector(playbackState),
    setPlayerState: setPlayerStateMock,
}));
vi.mock('../../../src/stores/useAudioSettingsStore', () => ({
    useAudioSettingsStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
        enableMediaCache: false,
        audioEqualizerSettings: { enabled: false, effects: {}, bands: [] },
    }),
}));
vi.mock('../../../src/stores/useAppViewStore', () => ({
    useAppViewStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
        isPanelOpen: false,
        panelTab: 'queue',
    }),
}));
vi.mock('../../../src/stores/useStatusMessageStore', () => ({ setStatusMessage: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../../src/utils/appPlaybackGuards', () => ({ resolveNavidromePlaybackCarrier: () => null }));
vi.mock('../../../src/utils/replayGain', () => ({ calculateReplayGain: () => ({ linearGain: 1 }) }));
vi.mock('../../../src/services/audioEqualizerGraph', () => ({ applyAudioEqualizerSettings: vi.fn() }));
vi.mock('../../../src/services/playbackGraph', () => ({ buildPlaybackGraph: vi.fn() }));
vi.mock('../../../src/services/playedTrackCache', () => ({ cachePlayedTrackAssets: vi.fn() }));
vi.mock('../../../src/services/automix/crossfadeGraph', () => ({ rampGain: vi.fn() }));

const { usePlaybackAudioBridge } = await import('../../../src/hooks/usePlaybackAudioBridge');
const { setStatusMessage } = await import('../../../src/stores/useStatusMessageStore');
const { buildPlaybackFailureStatus, resolvePlaybackFailurePolicy } = await import('../../../src/services/playbackRecovery/playbackFailurePolicy');

const FAILED_SRC = 'blob:folia/undecodable-track';

const createDeck = (error: { code: number } | null) => ({
    error,
    paused: true,
    ended: false,
    getAttribute: (name: string) => (name === 'src' ? FAILED_SRC : null),
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
    load: vi.fn(),
});

const renderBridge = (deck: ReturnType<typeof createDeck>, shouldAutoPlayRef: { current: boolean }) => {
    playbackState.audioSrc = FAILED_SRC;
    reactHooks.startRender();
    usePlaybackAudioBridge({
        audioRef: { current: deck as unknown as HTMLAudioElement },
        localSongs: [],
        isLyricsLoading: false,
        shouldAutoPlayRef,
        audioContextRef: { current: null },
        analyserRef: { current: null },
        gainNodeRef: { current: null },
        connectDecks: () => true,
        getActiveChain: () => null,
        suppressAutoplayRef: { current: false },
        isAutoplayHeld: false,
        syncOutputGain: vi.fn(),
        getTargetPlaybackVolume: () => 1,
        getCoverUrl: () => null,
        updateCacheSize: vi.fn(),
    } as never);
    reactHooks.flush();
};

describe('autoplay intent while a failed source is being transcoded', () => {
    beforeEach(() => {
        reactHooks.refs.length = 0;
        setPlayerStateMock.mockClear();
        // node 环境下没有可写的 localStorage，被测 hook 会往里写 replaygain 模式。
        globalThis.localStorage = { setItem: () => {}, getItem: () => null } as never;
    });

    it('keeps the intent instead of spending it on a deck that already errored', () => {
        const deck = createDeck({ code: 4 });
        const shouldAutoPlayRef = { current: true };

        renderBridge(deck, shouldAutoPlayRef);

        expect(deck.play).not.toHaveBeenCalled();
        // The transcode fallback re-points this deck once FFmpeg is done; that commit is the one
        // meant to start it, and it can only do so if the intent is still standing.
        expect(shouldAutoPlayRef.current).toBe(true);
    });

    it('still starts a healthy deck', () => {
        const deck = createDeck(null);
        const shouldAutoPlayRef = { current: true };

        renderBridge(deck, shouldAutoPlayRef);

        expect(deck.play).toHaveBeenCalledTimes(1);
        expect(shouldAutoPlayRef.current).toBe(false);
    });
});

describe('a leftover playback-failure toast when autoplay starts a deck', () => {
    beforeEach(() => {
        reactHooks.refs.length = 0;
        vi.mocked(setStatusMessage).mockClear();
        globalThis.localStorage = { setItem: () => {}, getItem: () => null } as never;
    });

    // transport 的 TTL 刷新、play() 失败后的恢复都把新音源交给这里起播：播放真正开始了，没有关闭按钮的失败提示要收起。
    it('clears the retry / skip toast once play() resolves and leaves every other message alone', async () => {
        const deck = createDeck(null);
        renderBridge(deck, { current: true });
        await vi.waitFor(() => expect(setStatusMessage).toHaveBeenCalled());

        const update = vi.mocked(setStatusMessage).mock.calls.at(-1)![0] as (prev: StatusMessage | null) => StatusMessage | null;
        const t = (key: string) => key;
        const failureToast = buildPlaybackFailureStatus(
            resolvePlaybackFailurePolicy({ reason: 'unknown', stage: 'resolve-url' }, 'play'),
            t,
            { retry: vi.fn(), skip: vi.fn(), dismiss: vi.fn() },
        );
        const countdown: StatusMessage = { type: 'error', text: 'status.songUnavailablePrompt', persistent: true };
        expect(update(failureToast)).toBeNull();
        expect(update(countdown)).toBe(countdown);
        expect(update(null)).toBeNull();
    });

    it('leaves the toast when play() is rejected', async () => {
        const deck = createDeck(null);
        deck.play.mockImplementationOnce(() => Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' })));
        renderBridge(deck, { current: true });
        await vi.waitFor(() => expect(setStatusMessage).toHaveBeenCalled());

        expect(vi.mocked(setStatusMessage).mock.calls.every(([next]) => typeof next !== 'function')).toBe(true);
    });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/playback/transcodeAutoplayIntent.test.ts
// 仓库的 vitest 跑在 node 环境，没有 jsdom，也没有 testing-library：按 usePersonalFmModeController
// 的做法就地复刻 useRef/useEffect/useCallback，直接驱动 usePlaybackAudioBridge 的真实实现，
// 只断言自动播放 effect 对「这一路 source 已经失败、转码正在进行中」的处理。

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
        // No mod's curve: what is heard is the settings above (utils/audioEqualizerModCurve.ts).
        audioEqualizerModCurve: null,
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
vi.mock('../../../src/services/audioEqualizerGraph', () => ({
    applyAudioEqualizerSettings: vi.fn(),
    planAudioEqualizerApply: () => ({ defer: false, timeConstant: 0.015 }),
}));
vi.mock('../../../src/services/playbackGraph', () => ({ buildPlaybackGraph: vi.fn() }));
vi.mock('../../../src/services/playedTrackCache', () => ({ cachePlayedTrackAssets: vi.fn() }));
vi.mock('../../../src/services/automix/crossfadeGraph', () => ({ rampGain: vi.fn() }));
vi.mock('../../../src/services/automix/profileService', () => ({ onTrackProfile: () => () => undefined }));
vi.mock('../../../src/services/volumeBalance/balancePlay', () => ({ createBalancePlay: () => ({ apply: () => null, reset: () => undefined }) }));
vi.mock('../../../src/services/volumeBalance/balanceRecords', () => ({ onBalanceRecord: () => () => undefined }));

const { usePlaybackAudioBridge } = await import('../../../src/components/app/playback/bridges/usePlaybackAudioBridge');

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

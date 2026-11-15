import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMMAND_PALETTE_COMMANDS } from '@/components/command-palette/commandRegistry';
import type { CommandPaletteContext } from '@/components/command-palette/types';
import { resolvePlayerCapsuleNavigationTarget, resolveStartupView, isStartupLatticeDeferred } from '@/hooks/useAppNavigation';
import {
    isPlaybackEntryView,
    resolvePlaybackSurface,
    type PlaybackEntryView,
    type usePlaybackEntryViewStore as StoreHook,
} from '@/stores/usePlaybackEntryViewStore';

// test/unit/stores/playbackEntryViewStore.test.ts
// 「播放后进入的视图」的第三个值「留在原处」（fb3）：存储读回（旧值兼容、未知值回退 player）、持久化、显式进入播放视图时
// stay 去播放页；三条选项命令的 isAvailable / 执行与当前值互斥。store 在 import 时读存储，所以每个用例重新 import 一份。

const ENTRY_VIEW_KEY = 'playback_entry_view';

let storage: Map<string, string>;

const loadStore = async (initial: Record<string, string> = {}): Promise<typeof StoreHook> => {
    vi.resetModules();
    storage = new Map(Object.entries(initial));
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => { storage.set(key, value); },
    });
    return (await import('@/stores/usePlaybackEntryViewStore')).usePlaybackEntryViewStore;
};

afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
});

describe('playback entry view store', () => {
    it('defaults to the player when nothing is stored', async () => {
        const store = await loadStore();
        expect(store.getState().playbackEntryView).toBe('player');
    });

    it('reads back the two values stored before stay existed', async () => {
        expect((await loadStore({ [ENTRY_VIEW_KEY]: 'player' })).getState().playbackEntryView).toBe('player');
        expect((await loadStore({ [ENTRY_VIEW_KEY]: 'lattice' })).getState().playbackEntryView).toBe('lattice');
    });

    it('reads back stay, and falls back to the player for anything unknown', async () => {
        expect((await loadStore({ [ENTRY_VIEW_KEY]: 'stay' })).getState().playbackEntryView).toBe('stay');
        expect((await loadStore({ [ENTRY_VIEW_KEY]: 'home' })).getState().playbackEntryView).toBe('player');
        expect((await loadStore({ [ENTRY_VIEW_KEY]: '' })).getState().playbackEntryView).toBe('player');
    });

    it('persists stay and marks the question as answered', async () => {
        const store = await loadStore();
        store.getState().setPlaybackEntryView('stay');
        expect(storage.get(ENTRY_VIEW_KEY)).toBe('stay');
        expect(store.getState().hasChosenPlaybackEntryView).toBe(true);
        expect((await loadStore(Object.fromEntries(storage))).getState().playbackEntryView).toBe('stay');
    });

    // 2026-10-10：首启提问分两页。「资料库界面」那一页每个安装问一次（自己的标记 library_suite_prompt_seen，不看版本）——
    // 回答过旧版单页提问的安装只剩这一页；播放视图那一页仍只看 playback_entry_view_chosen。
    it('opens with the pages still owed, and records both as answered when it closes', async () => {
        const fresh = await loadStore();
        expect(fresh.getState().requestPlaybackEntryViewPrompt({ withLibrarySuite: true })).toBe(true);
        expect(fresh.getState().promptPages).toEqual(['library-suite', 'playback-entry-view']);
        fresh.getState().closePlaybackEntryViewPrompt();
        expect(storage.get('playback_entry_view_chosen')).toBe('true');
        expect(storage.get('library_suite_prompt_seen')).toBe('true');
        expect(fresh.getState().requestPlaybackEntryViewPrompt({ withLibrarySuite: true })).toBe(false);

        const answeredBefore = await loadStore({ playback_entry_view_chosen: 'true' });
        expect(answeredBefore.getState().requestPlaybackEntryViewPrompt({ withLibrarySuite: true })).toBe(true);
        expect(answeredBefore.getState().promptPages).toEqual(['library-suite']);

        // 只有一套 suite 的构建不问界面：答过播放视图就什么都不问。
        const singleSuite = await loadStore({ playback_entry_view_chosen: 'true' });
        expect(singleSuite.getState().requestPlaybackEntryViewPrompt({ withLibrarySuite: false })).toBe(false);
        expect((await loadStore()).getState().requestPlaybackEntryViewPrompt()).toBe(true);
    });

    it('recognises exactly the three values', () => {
        for (const value of ['player', 'lattice', 'stay']) expect(isPlaybackEntryView(value)).toBe(true);
        for (const value of ['home', '', null, undefined, 1]) expect(isPlaybackEntryView(value)).toBe(false);
    });
});

describe('explicitly opening the playback view', () => {
    it('sends stay to the player (it has no surface of its own)', () => {
        expect(resolvePlaybackSurface('player')).toBe('player');
        expect(resolvePlaybackSurface('lattice')).toBe('lattice');
        expect(resolvePlaybackSurface('stay')).toBe('player');
        expect(resolvePlayerCapsuleNavigationTarget('home', 'stay')).toBe('player');
        expect(resolvePlayerCapsuleNavigationTarget('lattice', 'stay')).toBeNull();
    });

    it('launches stay into the player and never defers a Lattice launch for it', () => {
        expect(resolveStartupView({ openPlayerOnLaunch: true, playbackEntryView: 'stay', queueLength: 3 })).toBe('player');
        expect(resolveStartupView({ openPlayerOnLaunch: false, playbackEntryView: 'stay', queueLength: 3 })).toBe('home');
        expect(isStartupLatticeDeferred({ openPlayerOnLaunch: true, playbackEntryView: 'stay' })).toBe(false);
    });
});

describe('playback entry view commands', () => {
    const IDS: Record<PlaybackEntryView, string> = {
        player: 'playback-entry-view-player',
        lattice: 'playback-entry-view-lattice',
        stay: 'playback-entry-view-stay',
    };
    const command = (id: string) => {
        const found = COMMAND_PALETTE_COMMANDS.find(candidate => candidate.id === id);
        if (!found) throw new Error(`missing command ${id}`);
        return found;
    };
    const createContext = (state: { view: PlaybackEntryView }) => {
        const setPlaybackEntryView = vi.fn((view: PlaybackEntryView) => { state.view = view; });
        const context = {
            shared: { t: (_key: string, fallback?: string) => fallback ?? '' },
            settings: {
                get playbackEntryView() { return state.view; },
                setPlaybackEntryView,
            },
        } as unknown as CommandPaletteContext;
        return { context, setPlaybackEntryView };
    };

    it('registers one settings command per value, without an execute shortcut', () => {
        for (const id of Object.values(IDS)) {
            expect(command(id).group).toBe('settings');
            expect(command(id).executeShortcut).toBeUndefined();
        }
    });

    it('offers each value only while it is not the current one', () => {
        for (const current of Object.keys(IDS) as PlaybackEntryView[]) {
            const { context } = createContext({ view: current });
            for (const [value, id] of Object.entries(IDS)) {
                expect(command(id).isAvailable?.(context)).toBe(value !== current);
            }
        }
    });

    it('switches to stay and refuses to switch to the value already chosen', async () => {
        const state = { view: 'player' as PlaybackEntryView };
        const { context, setPlaybackEntryView } = createContext(state);
        expect(await command(IDS.stay).execute('', context)).toBe(true);
        expect(setPlaybackEntryView).toHaveBeenCalledWith('stay');
        expect(state.view).toBe('stay');
        expect(await command(IDS.stay).execute('', context)).toBe(false);
        expect(await command(IDS.lattice).execute('', context)).toBe(true);
        expect(state.view).toBe('lattice');
    });
});

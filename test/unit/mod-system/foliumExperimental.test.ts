// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

// Stores read localStorage at import time; see foliumUiRegistries.test.ts.
vi.hoisted(() => {
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
});

// Lyrics from a mod parse in the lyrics worker; run the same parser inline.
vi.mock('@/utils/lyrics/workerClient', async () => {
    const { parseLyricsByFormat } = await import('@/utils/lyrics/parserCore');
    return {
        parseLyricsAsync: vi.fn(async (
            format: Parameters<typeof parseLyricsByFormat>[0],
            content: string,
            translation: string,
            options: Parameters<typeof parseLyricsByFormat>[3],
            romanization: string,
        ) => parseLyricsByFormat(format, content, translation, options, romanization)),
    };
});

import type { SongResult } from '@/types';
import type { ModRuntimeInfo } from '@/mods/types';
import type { FoliumRemoteActionsDef, FoliumRemoteActionsHandle } from '@/mods/folium/contract';
import { getOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { omni } from '@/services/onlineMusic/omni';
import { applyOmniAudioHook, applyOmniLyricsHook } from '@/services/hostExtensionHooks';
import { findPonderTarget } from '@/components/ponder/ponderRegistry';
import i18n from '@/i18n/config';
import { createFoliumExperimental, ponderTargetsRegistry } from '@/mods/folium/experimental';
import { omniProvidersRegistry } from '@/mods/folium/registries/omniProviders';
import { foliumProviderId, isFoliumProviderId } from '@/mods/folium/omni/providerIds';
import { remoteActionsRegistry } from '@/mods/folium/registries/remoteActions';
import { playbackBackendsRegistry } from '@/mods/folium/playbackBackends';
import { getPlaybackBackend, selectPlaybackBackend, selectedPlaybackBackend } from '@/services/playbackBackend/registry';
import { createFoliumClientApi } from '@/mods/folium/api';
import { clientApiOptions } from './clientApiOptions';
import { removeFoliumEventHandlers } from '@/mods/folium/events';
import { clearFoliumIssues, getFoliumIssues } from '@/mods/runtime/status';
import { clearFoliumOldNames, useFoliumOldNameStore } from '@/mods/folium/deprecated/warnings';

// test/unit/mod-system/foliumExperimental.test.ts
// The opt-in surfaces: a mod Omni provider adapted to the host contract, the
// Omni result hooks, Ponder targets, and the gate that keeps all of them out of
// reach without the manifest opt-in.

const mod = (overrides: Partial<ModRuntimeInfo> = {}): ModRuntimeInfo => ({
    id: 'mod-a', name: 'A', version: '1.0.0', author: null, description: null, permissions: [],
    status: 'loaded', error: null, enabled: true, trustStale: false, signature: { status: 'unsigned', reason: null, keyId: null, keyLabel: null, signedAt: null }, devSource: false, experimental: [], embedOrigins: [],
    folia: null, hasMain: false, clientUrl: null, ...overrides,
});

afterEach(() => {
    omniProvidersRegistry.unregisterAll('mod-a');
    ponderTargetsRegistry.unregisterAll('mod-a');
    remoteActionsRegistry.unregisterAll('mod-a');
    selectPlaybackBackend(null);
    playbackBackendsRegistry.unregisterAll('mod-a');
    removeFoliumEventHandlers('mod-a');
    clearFoliumOldNames('mod-a');
    vi.restoreAllMocks();
});

describe('playback.backends', () => {
    it('requires experimental opt-in and the source/device permission independently', () => {
        const hidden = mod({ permissions: ['playback.backend'] });
        const api = createFoliumClientApi(hidden, clientApiOptions('main', { experimental: createFoliumExperimental(hidden) }));
        expect(() => api.experimental['playback.backends']).toThrow('experimental-not-declared:playback.backends');
        const denied = mod({ experimental: ['playback.backends'] });
        const noPermission = createFoliumClientApi(denied, clientApiOptions('main', { experimental: createFoliumExperimental(denied) }));
        expect(() => noPermission.experimental['playback.backends']!.register({ id: 'test' } as never)).toThrow('permission-denied:playback.backend');
    });
    it('namespaces registration and preserves a missing selection after teardown', () => {
        const owner = mod({ permissions: ['playback.backend'], experimental: ['playback.backends'] });
        const api = createFoliumClientApi(owner, clientApiOptions('main', { experimental: createFoliumExperimental(owner) }));
        const handle = api.experimental['playback.backends']!.register({
            id: 'output', name: 'Test output', capabilities: { seek: false, volume: false, http: false },
            create: () => ({ open: async () => {}, play: async () => {}, pause: async () => {}, seek: async () => {}, setVolume: async () => {}, dispose: () => {} }),
        });
        expect(handle.id).toBe('mod-a:output');
        expect(selectedPlaybackBackend()).toBeNull();
        selectPlaybackBackend(handle.id);
        handle.unregister();
        expect(selectedPlaybackBackend()).toBe(handle.id);
        expect(getPlaybackBackend()).toBeNull();
    });
});

describe('omni.providers', () => {
    it('adapts a mod provider to the host contract and removes it again', async () => {
        const handle = omniProvidersRegistry.register('mod-a', {
            id: 'radio',
            displayName: 'Mod Radio',
            search: async (query) => ({ items: [{ id: 's1', title: `${query}!`, artists: ['X', 'Y'] }], hasMore: false }),
            getAudioUrl: async (song) => ({ url: `https://cdn.example/${song.id}.mp3` }),
            getLyrics: async () => ({ main: { format: 'lrc', text: '[00:01.00]hello\n[00:03.00]world' } }),
        });
        const provider = getOnlineMusicProvider('folium.mod-a.radio');
        expect(provider?.capabilities).toMatchObject({ search: true, playback: true, lyrics: true, auth: false });

        const page = await provider!.search!.searchSongs('q', 10, 0);
        const song = page.items[0];
        expect(song.sourceRef).toEqual({ kind: 'online', providerId: 'folium.mod-a.radio', mediaId: 's1' });
        expect(song.artists.map((artist) => artist.name)).toEqual(['X', 'Y']);
        expect(page.nextOffset).toBe(1);

        const audio = await provider!.playback!.getAudioSource(song, 'high');
        expect(audio).toMatchObject({ url: 'https://cdn.example/s1.mp3', quality: 'high' });

        const lyrics = await provider!.lyrics!.getLyrics(song);
        expect(lyrics.lyrics?.lines.map((line) => line.fullText)).toEqual(['hello', 'world']);

        handle.unregister();
        expect(getOnlineMusicProvider('folium.mod-a.radio')).toBeNull();
    });

    // Folium 1.6 only: the Folium 1.3 answer `{ lrc, translationLrc }` still reads, and is said once in the mod's row.
    const OLD_LYRICS_LINE = "getLyrics answering { lrc, translationLrc }: removed in Folium 2, use { main: { format: 'lrc', text, translationText } }";
    const song = { id: 's1', name: 'Song', artists: [], album: { id: 'a', name: '' }, durationMs: 0 } as unknown as SongResult;

    it('reads the Folium 1.3 lyrics answer { lrc } and says the old name once', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        omniProvidersRegistry.register('mod-a', { id: 'old', displayName: 'Old', getLyrics: async () => ({ lrc: '[00:01.00]a' }) });
        const provider = getOnlineMusicProvider('folium.mod-a.old')!;
        for (let time = 0; time < 2; time += 1) {
            const answer = await provider.lyrics!.getLyrics(song);
            expect(answer.lyrics?.lines.map((line) => line.fullText)).toEqual(['a']);
            expect(answer.mainText).toBe('[00:01.00]a');
        }
        expect(useFoliumOldNameStore.getState().byMod['mod-a']).toEqual([OLD_LYRICS_LINE]);
        expect(console.warn).toHaveBeenCalledWith(`[Folium:mod-a] ${OLD_LYRICS_LINE}`);
        expect(vi.mocked(console.warn).mock.calls.filter(([text]) => String(text).includes('getLyrics answering'))).toHaveLength(1);
    });

    it('keeps a class-made provider whole, #private fields included, and reads its old lyrics answer', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        class OldSource {
            id = 'cls';
            displayName = 'Class source';
            #lastQuery = '';
            async search(query: string) {
                this.#lastQuery = query;
                return { items: [{ id: 's1', title: query, artists: [] }], hasMore: false };
            }
            async getLyrics() {
                return { lrc: `[00:01.00]${this.#lastQuery}` };
            }
        }
        omniProvidersRegistry.register('mod-a', new OldSource());
        const provider = getOnlineMusicProvider('folium.mod-a.cls')!;
        expect(provider.capabilities).toMatchObject({ search: true, lyrics: true });
        const [found] = (await provider.search!.searchSongs('b', 10, 0)).items;
        expect(found.name).toBe('b');
        expect((await provider.lyrics!.getLyrics(found)).lyrics?.lines.map((line) => line.fullText)).toEqual(['b']);
        expect(useFoliumOldNameStore.getState().byMod['mod-a']).toEqual([OLD_LYRICS_LINE]);
    });

    it('passes word-timed lyrics and chorus ranges through Omni', async () => {
        omniProvidersRegistry.register('mod-a', {
            id: 'wbw',
            displayName: 'Word by word',
            search: async () => ({ items: [{ id: 's1', title: 'S', artists: [] }], hasMore: false }),
            getLyrics: async () => ({
                main: { format: 'lrc', text: '[00:01.00]你好\n[00:03.00]世界', translationText: '[00:01.00]hello\n[00:03.00]world' },
                wordByWord: { format: 'yrc', text: '[1000,800](1000,250,0)你(1250,250,0)好\n[3000,800](3000,400,0)世(3400,400,0)界' },
                chorusRanges: [{ startTime: 2.5, endTime: 4 }],
            }),
        });
        const provider = getOnlineMusicProvider('folium.mod-a.wbw');
        expect(provider?.capabilities.wordByWordLyrics).toBe(true);

        const [song] = (await provider!.search!.searchSongs('q', 10, 0)).items;
        const result = await omni.getLyrics(song);
        const lines = result.lyrics!.lines.filter((line) => line.fullText !== '......');

        expect(result.lyrics?.isWordByWord).toBe(true);
        expect(lines.map((line) => [line.fullText, line.translation, Boolean(line.isChorus)])).toEqual([
            ['你好', 'hello', false],
            ['世界', 'world', true],
        ]);
        expect(lines[1].words.map((word) => word.startTime)).toEqual([3, 3.4]);
        expect(result.chorusRanges).toEqual([{ startTime: 2.5, endTime: 4 }]);
    });

    it('refuses a provider with no capability', () => {
        expect(() => omniProvidersRegistry.register('mod-a', { id: 'empty', displayName: 'x' })).toThrow('at least one');
    });

    // `songDetail` tells a source that can look songs up by id (`getSong`) from one that cannot,
    // before anything is asked; what `getSongDetail` answers stays as it was.
    it('says whether songs can be looked up by id, and looks them up as before', async () => {
        const getSong = vi.fn(async (id: string) => ({ id, title: `Song ${id}`, artists: ['X'] }));
        const audio = async (song: { id: string }) => ({ url: `https://cdn.example/${song.id}.mp3` });
        omniProvidersRegistry.register('mod-a', { id: 'full', displayName: 'Full', getSong, getAudioUrl: audio });
        omniProvidersRegistry.register('mod-a', { id: 'noget', displayName: 'No getSong', getAudioUrl: audio });
        omniProvidersRegistry.register('mod-a', { id: 'noaudio', displayName: 'No audio', getSong, getLyrics: async () => ({ main: { format: 'lrc', text: '' } }) });

        const full = getOnlineMusicProvider('folium.mod-a.full')!;
        expect(full.capabilities).toMatchObject({ playback: true, songDetail: true });
        const found = await omni.getSongDetail('folium.mod-a.full', 's7');
        expect(found).toMatchObject({ id: 's7', name: 'Song s7', sourceRef: { kind: 'online', providerId: 'folium.mod-a.full', mediaId: 's7' } });
        expect(getSong).toHaveBeenCalledWith('s7');

        expect(getOnlineMusicProvider('folium.mod-a.noget')!.capabilities).toMatchObject({ playback: true, songDetail: false });
        await expect(omni.getSongDetail('folium.mod-a.noget', 's7')).resolves.toBeNull();

        // A source without audio has no playback, and no lookup by id however it declares getSong.
        getSong.mockClear();
        const noAudio = getOnlineMusicProvider('folium.mod-a.noaudio')!;
        expect(noAudio.capabilities).toMatchObject({ playback: false, songDetail: true });
        expect(noAudio.playback).toBeUndefined();
        await expect(omni.getSongDetail('folium.mod-a.noaudio', 's7')).resolves.toBeNull();
        expect(getSong).not.toHaveBeenCalled();
    });

    it('names a mod\'s source by the id omni/providerIds.ts makes, which tells it from a built-in one', () => {
        expect(foliumProviderId('mod-a:radio')).toBe('folium.mod-a.radio');
        omniProvidersRegistry.register('mod-a', { id: 'radio', displayName: 'Radio', search: async () => ({ items: [], hasMore: false }) });
        expect(getOnlineMusicProvider(foliumProviderId('mod-a:radio'))?.displayName).toBe('Radio');
        expect(isFoliumProviderId('folium.mod-a.radio')).toBe(true);
        expect(isFoliumProviderId('netease')).toBe(false);
        expect(isFoliumProviderId('local')).toBe(false);
    });
});

describe('omni.hooks', () => {
    const song = { id: 1, name: 'S', artists: [], album: { id: 1, name: '' }, durationMs: 0 } as unknown as SongResult;

    it('passes through while nobody listens and applies handlers once they do', async () => {
        const source = { url: 'https://a.example/x.mp3', fetchedAt: 1, quality: 'high' as const };
        expect(await applyOmniAudioHook(song, source)).toBe(source);

        const experimental = createFoliumExperimental(mod({ experimental: ['omni.hooks'] }));
        (experimental['omni.hooks'] as { on: (type: string, handler: (event: any) => void) => void }).on('audioSourceResolved', (event) => {
            event.url = 'https://b.example/y.mp3';
        });
        (experimental['omni.hooks'] as { on: (type: string, handler: (event: any) => void) => void }).on('lyricsResolved', (event) => {
            event.lines = event.lines.map((line: { fullText: string }) => ({ ...line, fullText: line.fullText.toUpperCase() }));
        });

        expect(await applyOmniAudioHook(song, source)).toMatchObject({ url: 'https://b.example/y.mp3', quality: 'high' });
        const lyrics = await applyOmniLyricsHook(song, {
            lyrics: { lines: [{ words: [], startTime: 0, endTime: 1, fullText: 'hi' }] },
            isPureMusic: false,
        });
        expect(lyrics.lyrics?.lines[0].fullText).toBe('HI');
    });
});

describe('ponder.targets', () => {
    const scene = {
        id: 'intro',
        titleKey: { 'zh-CN': '认识面板', en: 'Meet the panel' },
        action: { kind: 'openUrl', url: 'https://example.com', labelKey: 'Docs: open' },
        anchors: {
            panel: { kind: 'synthetic', rect: { left: 0.1, top: 0.1, width: 0.5, height: 0.5 }, role: 'surface', labelKey: { 'zh-CN': '面板', en: 'Panel' } },
            box: { kind: 'synthetic', rect: { left: 0.2, top: 0.2, width: 0.1, height: 0.1 } },
        },
        steps: [
            { kind: 'caption', textKey: { 'zh-CN': '按 {{mod}} + K 打开', en: 'Press {{mod}} + K to open' }, durationMs: 1000 },
            { kind: 'pause', dwellMs: 200 },
        ],
    };

    it('adds a namespaced target whose text reads through t()', () => {
        ponderTargetsRegistry.register('mod-a', {
            id: 'panel',
            titleKey: 'My mod panel. With: punctuation',
            category: 'playback',
            hoverSelector: '[data-folium-entry="mod-a:panel"]',
            scenes: [],
        });
        const target = findPonderTarget('mod-a:panel' as never);
        expect(target).not.toBeNull();
        expect(i18n.t(target!.titleKey)).toBe('My mod panel. With: punctuation');
        ponderTargetsRegistry.unregisterAll('mod-a');
        expect(findPonderTarget('mod-a:panel' as never)).toBeNull();
    });

    it('localizes every text field per language and interpolates {{mod}}', async () => {
        const definition = { id: 'tour', titleKey: { 'zh-CN': '导览', en: 'Tour' }, summaryKey: 'Only one text', category: 'playback', hoverSelector: null, scenes: [scene] };
        const before = JSON.stringify(definition);
        ponderTargetsRegistry.register('mod-a', definition);
        const target = findPonderTarget('mod-a:tour' as never)!;
        const [localized] = target.scenes;
        const caption = localized.steps[0] as { textKey: string };

        await i18n.changeLanguage('zh-CN');
        expect(i18n.t(target.titleKey)).toBe('导览');
        expect(i18n.t(localized.titleKey)).toBe('认识面板');
        expect(i18n.t(localized.anchors.panel.labelKey!)).toBe('面板');
        expect(i18n.t(caption.textKey, { mod: 'Ctrl' })).toBe('按 Ctrl + K 打开');

        await i18n.changeLanguage('en');
        expect(i18n.t(target.titleKey)).toBe('Tour');
        expect(i18n.t(target.summaryKey!)).toBe('Only one text');
        expect(i18n.t(localized.action!.labelKey)).toBe('Docs: open');
        expect(i18n.t(caption.textKey, { mod: '⌘' })).toBe('Press ⌘ + K to open');
        // A language the label does not name falls back like every other mod label.
        await i18n.changeLanguage('in');
        expect(i18n.t(localized.titleKey)).toBe('认识面板');
        await i18n.changeLanguage('en');

        expect(localized.anchors.box.labelKey).toBeUndefined();
        // A mod's panel is drawn as a bare frame unless it names a host skeleton.
        expect(localized.anchors.panel.surfaceKind).toBe('plain');
        expect(localized.anchors.box.surfaceKind).toBeUndefined();
        expect(JSON.stringify(definition)).toBe(before);

        ponderTargetsRegistry.unregisterAll('mod-a');
        expect(i18n.hasResourceBundle('en', 'folium-ponder/mod-a/tour')).toBe(false);
    });

    it('rejects a text field that is neither text nor a label', () => {
        expect(() => ponderTargetsRegistry.register('mod-a', {
            id: 'bad',
            titleKey: 'Fine',
            category: 'playback',
            hoverSelector: null,
            scenes: [{ ...scene, steps: [{ kind: 'caption', textKey: 42, durationMs: 1 }] }],
        })).toThrow(/scenes\[0\]\.steps\[0\]\.textKey/);
        expect(findPonderTarget('mod-a:bad' as never)).toBeNull();
    });

    it('reads a throwing isAvailable as "applies" and reports it under its mod', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        ponderTargetsRegistry.register('mod-a', {
            id: 'moody',
            titleKey: 'Moody',
            category: 'playback',
            hoverSelector: null,
            isAvailable: () => { throw new Error('target boom'); },
            scenes: [
                { ...scene, isAvailable: () => { throw new Error('scene boom'); } },
                { ...scene, id: 'off', isAvailable: () => false },
            ],
        });
        const target = findPonderTarget('mod-a:moody' as never)!;
        // The host's own tests are `=== false`, `!== false` and `?? candidate` (PonderRelatedTargets.tsx):
        // undefined reads as "applies" in all three.
        expect(target.isAvailable!()).toBeUndefined();
        expect(target.scenes[0].isAvailable!()).toBeUndefined();
        expect(target.scenes[1].isAvailable!()).toBe(false);
        expect(getFoliumIssues('mod-a')).toMatchObject([
            { where: 'ponder target mod-a:moody isAvailable', message: 'target boom' },
            { where: 'ponder target mod-a:moody scene intro isAvailable', message: 'scene boom' },
        ]);
        clearFoliumIssues('mod-a');
        warn.mockRestore();
    });
});

describe('experimental gate', () => {
    it('keeps undeclared surfaces and omni events out of reach', () => {
        const api = createFoliumClientApi(mod(), clientApiOptions('main', { experimental: createFoliumExperimental(mod()) }));
        expect(() => api.experimental['omni.providers']).toThrow('experimental-not-declared:omni.providers');
        expect(() => api.experimental['remote.actions']).toThrow('experimental-not-declared:remote.actions');
        expect(() => api.events.on('omni.audioSourceResolved', () => {})).toThrow('experimental-not-declared:omni.hooks');
        // A name the events table does not have is refused by name, not left to never fire.
        expect(() => api.events.on('lyrics.transfrom' as never, () => {})).toThrow('unknown-event:lyrics.transfrom');
        expect(() => api.events.on('toString' as never, () => {})).toThrow('unknown-event:toString');

        const hooked = mod({ experimental: ['omni.hooks'] });
        const listening = createFoliumClientApi(hooked, clientApiOptions('main'));
        const off = listening.events.on('omni.audioSourceResolved', () => {});
        expect(off).toEqual(expect.any(Function));
        off();

        const optedIn = mod({ experimental: ['omni.providers'] });
        const allowed = createFoliumClientApi(optedIn, clientApiOptions('main', { experimental: createFoliumExperimental(optedIn) }));
        expect(allowed.experimental['omni.providers']).toHaveProperty('register');
    });

    it('exposes only an owned action registration through remote.actions opt-in', () => {
        const owner = mod({ experimental: ['remote.actions'] });
        const api = createFoliumClientApi(owner, clientApiOptions('main', { experimental: createFoliumExperimental(owner) }));
        const remote = api.experimental['remote.actions'] as { register: (def: FoliumRemoteActionsDef) => FoliumRemoteActionsHandle };
        const handle = remote.register({ id: 'room', actions: () => [] });
        expect(handle.id).toBe('mod-a:room');
        expect(handle.invalidate).toBeTypeOf('function');
        expect(remoteActionsRegistry.list()).toHaveLength(1);
        handle.unregister();
        expect(remoteActionsRegistry.list()).toHaveLength(0);
    });
});


describe('player.layout declaration without a standalone experimental service', () => {
    it('keeps layout access on the stage context and leaves the stable Folium version as it is', () => {
        for (const experimental of [[], ['player.layout']]) {
            const descriptor = mod({ experimental });
            const api = createFoliumClientApi(descriptor, clientApiOptions('main', { experimental: createFoliumExperimental(descriptor) }));
            expect(api.host.folium).toEqual({ major: 1, minor: 7 });
            expect(() => api.experimental['player.layout']).toThrow(
                experimental.length ? 'experimental-unknown:player.layout' : 'experimental-not-declared:player.layout',
            );
        }
        const exported = createFoliumClientApi(mod({ experimental: ['player.layout'] }), clientApiOptions('export'));
        expect(() => exported.experimental['player.layout']).toThrow('experimental-unknown:player.layout');
    });
});

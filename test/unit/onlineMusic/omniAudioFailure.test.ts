import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedSong } from '@/types';
import { OnlineProviderError, type OnlineMusicProvider, type ProviderCapabilities } from '@/types/onlineMusic';

// test/unit/onlineMusic/omniAudioFailure.test.ts
// provider 拒绝给音源时，已安装的音频钩子仍可补救；补救不了就原样重抛同一个错误实例，且不保存 ReplayGain。

const mocks = vi.hoisted(() => ({
    applyOmniAudioHook: vi.fn(),
    saveSongReplayGain: vi.fn(),
}));

vi.mock('@/services/hostExtensionHooks', () => ({
    applyOmniAudioHook: mocks.applyOmniAudioHook,
    applyOmniLyricsHook: vi.fn(async (_song: unknown, result: unknown) => result),
}));

vi.mock('@/services/onlineMusic/resourceCache', async importOriginal => ({
    ...(await importOriginal<typeof import('@/services/onlineMusic/resourceCache')>()),
    saveSongReplayGain: mocks.saveSongReplayGain,
}));

const { omni } = await import('@/services/onlineMusic/omni');
const { registerOnlineMusicProvider, unregisterOnlineMusicProvider } = await import('@/services/onlineMusic/providerRegistry');

const providerId = 'omni-audio-failure-test';
const capabilities: ProviderCapabilities = {
    search: false, playback: true, lyrics: false, auth: false, userLibrary: false,
    playlists: false, albums: false, artists: false, recommendations: false,
    mutations: false, wordByWordLyrics: false,
};
const song: UnifiedSong = {
    id: '1',
    name: 'Song',
    artists: [],
    album: { id: '', name: '' },
    durationMs: 1,
    sourceRef: { kind: 'online', providerId, mediaId: '1' },
};

const getAudioSource = vi.fn();

const provider: OnlineMusicProvider = {
    id: providerId,
    displayName: providerId,
    capabilities,
    normalizeSong: () => song,
    playback: {
        getSongDetail: async () => song,
        getAudioSource,
    },
};

describe('omni.getAudioSource when the provider refuses', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        registerOnlineMusicProvider(provider);
    });

    afterEach(() => {
        unregisterOnlineMusicProvider(providerId);
    });

    it('returns the source an audio hook supplies instead', async () => {
        const refusal = new OnlineProviderError('not-playable', 'No rights', providerId);
        const rescued = { url: 'https://hook.example/song.mp3', fetchedAt: 1, quality: 'high' as const };
        getAudioSource.mockRejectedValueOnce(refusal);
        mocks.applyOmniAudioHook.mockResolvedValueOnce(rescued);

        await expect(omni.getAudioSource(song, 'high')).resolves.toBe(rescued);
        expect(mocks.applyOmniAudioHook).toHaveBeenCalledWith(song, null);
        expect(mocks.saveSongReplayGain).not.toHaveBeenCalled();
    });

    it('rethrows the very same error instance when the hook has nothing', async () => {
        const refusal = new OnlineProviderError('network', 'offline', providerId);
        getAudioSource.mockRejectedValueOnce(refusal);
        mocks.applyOmniAudioHook.mockResolvedValueOnce(null);

        const caught = await omni.getAudioSource(song, 'high').catch(error => error);

        expect(caught).toBe(refusal);
        expect(mocks.saveSongReplayGain).not.toHaveBeenCalled();
    });

    it('rethrows when the hook returns a source without a URL', async () => {
        const refusal = new OnlineProviderError('not-playable', 'empty', providerId);
        getAudioSource.mockRejectedValueOnce(refusal);
        mocks.applyOmniAudioHook.mockResolvedValueOnce({ url: '', fetchedAt: 1, quality: 'high' });

        await expect(omni.getAudioSource(song, 'high')).rejects.toBe(refusal);
    });

    it('still saves ReplayGain and runs the hook on success', async () => {
        const source = { url: 'https://provider.example/song.flac', fetchedAt: 1, quality: 'high' as const, replayGain: { trackGain: -6 } };
        getAudioSource.mockResolvedValueOnce(source);
        mocks.applyOmniAudioHook.mockImplementationOnce(async (_song, value) => value);

        await expect(omni.getAudioSource(song, 'high')).resolves.toBe(source);
        expect(mocks.saveSongReplayGain).toHaveBeenCalledWith(song, { trackGain: -6 });
        expect(mocks.applyOmniAudioHook).toHaveBeenCalledWith(song, source);
    });
});

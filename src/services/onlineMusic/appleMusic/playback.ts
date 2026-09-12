import type { RemotePlaybackBackend } from '../../../types/remotePlayback';
import { requestMusicKit } from './musicKitTransport';

// src/services/onlineMusic/appleMusic/playback.ts

export const musicKitPlayback: RemotePlaybackBackend = {
    async start(id, options = {}) {
        // MusicKit only offers two tiers; everything above standard maps to its 256 kbps AAC.
        await requestMusicKit('start', { id, bitrate: options.quality === 'standard' ? 64 : 256, continueIfCurrent: Boolean(options.continueIfCurrent) });
    },
    async command(command, value) { await requestMusicKit('command', { command, value }); },
    async snapshot() { return requestMusicKit('snapshot'); },
    async queueNext(id) { await requestMusicKit('queueNext', { id }); },
};

import { OnlineProviderError } from '../../../types/onlineMusic';

// src/services/onlineMusic/appleMusic/musicKitTransport.ts

export async function requestMusicKit<T>(action: string, input?: Record<string, unknown>): Promise<T> {
    if (!window.electron?.appleMusicRequest) throw new OnlineProviderError('unavailable', 'Desktop required.', 'applemusic');
    const result = await window.electron.appleMusicRequest(action, input);
    if (!result.ok) {
        const reason = result.error || 'musickit-failed';
        const code = reason === 'auth-required' || reason.startsWith('developer-token') ? 'auth-required'
            : reason === 'lyrics-network-error' ? 'network'
            : reason === 'widevine-unavailable' || reason === 'lyrics-service-unavailable' ? 'unavailable' : 'invalid-response';
        throw new OnlineProviderError(code, reason, 'applemusic');
    }
    return result.data as T;
}

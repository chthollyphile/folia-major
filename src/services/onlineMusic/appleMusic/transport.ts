import { readProviderSessionValue } from '../providerStorage';
import { OnlineProviderError } from '../../../types/onlineMusic';
import { requestMusicKit } from './musicKitTransport';

// src/services/onlineMusic/appleMusic/transport.ts

export interface AppleRequestInit {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    body?: Record<string, unknown>;
}

export const hasMusicKit = () => typeof window !== 'undefined' && window.electron?.appleMusicAvailable === true && Boolean(window.electron.appleMusicRequest);

export async function requestApple<T>(path: string, init?: AppleRequestInit): Promise<T> {
    if (readProviderSessionValue('applemusic', 'disconnected') === 'true') throw new OnlineProviderError('auth-required', 'Connect Apple Music from the account menu.', 'applemusic');
    const write = Boolean(init?.method && init.method !== 'GET');
    return requestMusicKit<T>('api', { path, ...(write ? { method: init!.method, body: init!.body } : {}) });
}

export async function getStorefront(): Promise<string> {
    const response = await requestApple<{ data: Array<{ id: string }> }>('/v1/me/storefront');
    const id = response.data?.[0]?.id;
    if (!id || !/^[a-z]{2}$/.test(id)) throw new OnlineProviderError('auth-required', 'Sign in to Apple Music.', 'applemusic');
    return id;
}

export const applePath = (id: string, storefront: string, suffix = '') => (
    id.startsWith('i.') || id.startsWith('p.')
        ? `/v1/me/library/${id.startsWith('p.') ? 'playlists' : 'songs'}/${encodeURIComponent(id)}${suffix}`
        : `/v1/catalog/${storefront}/songs/${encodeURIComponent(id)}${suffix}`
);

// Library albums carry `l.` ids and live under the user's library rather than the storefront catalog.
export const appleAlbumPath = (id: string, storefront: string, suffix = '') => (
    id.startsWith('l.')
        ? `/v1/me/library/albums/${encodeURIComponent(id)}${suffix}`
        : `/v1/catalog/${storefront}/albums/${encodeURIComponent(id)}${suffix}`
);

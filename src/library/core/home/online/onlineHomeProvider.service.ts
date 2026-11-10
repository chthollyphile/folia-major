import type { OmniProviderCapabilities } from '../../../../types/onlineMusic';
import { omni } from '../../../../services/onlineMusic/omni';

// src/library/core/home/online/onlineHomeProvider.service.ts
// 首页读当前在线 provider 的能力与名字（经 omni）。原先在 Grid3D 里：provider 可能被 Folium mod 随时移除，
// 读一个刚消失的 provider 不能在渲染时抛错把首页带崩，所以读不到时按「什么都不支持」处理。

export const NO_PROVIDER_CAPABILITIES: OmniProviderCapabilities = {
    search: false,
    playback: false,
    lyrics: false,
    auth: false,
    userLibrary: false,
    playlists: false,
    albums: false,
    artists: false,
    recommendations: false,
    mutations: false,
    wordByWordLyrics: false,
};

// The platform only hands out registered provider ids, but a Folium mod can remove its provider at any
// time; reading a provider that just went away must not throw during render and take the home view down.
export const readOnlineProviderCapabilities = (providerId: string): OmniProviderCapabilities => {
    try {
        return omni.getProviderCapabilities(providerId);
    } catch {
        return NO_PROVIDER_CAPABILITIES;
    }
};

export const readOnlineProviderLabel = (providerId: string): string => omni.getProviderLabel(providerId);

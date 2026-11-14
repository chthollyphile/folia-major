import { describe, expect, it, vi } from 'vitest';
import type { ProviderAccountSummary } from '@/types/onlineMusic';

// test/unit/search/searchSources.test.ts
// 搜索页的来源：当前平台总在最前；其余在线平台只列已登录的和不需要登录的（未配置的不列）；本地有歌才列，
// Navidrome 配好了才列。

// The hook beside the rule reads the Navidrome switch at import; the rule itself is pure.
vi.mock('@/services/navidromeService', () => ({ getNavidromeConfig: () => null, isNavidromeEnabled: () => false }));

const { resolveSearchSources } = await import('@/components/app/search/searchSources');

const provider = (providerId: string, overrides: Partial<ProviderAccountSummary> = {}): ProviderAccountSummary => ({
    providerId,
    displayName: providerId,
    shortName: providerId,
    availability: { configured: true },
    requiresAccount: true,
    status: 'anonymous',
    user: null,
    collections: [],
    hydration: 'ready',
    freshness: 'fresh',
    ...overrides,
} as ProviderAccountSummary);

const providers = [
    provider('netease', { status: 'authenticated' }),
    provider('qq'),
    provider('kugou', { status: 'authenticated' }),
    provider('spotify', { status: 'authenticated', availability: { configured: false } }),
    provider('folium.mod.source', { requiresAccount: false }),
];

describe('search sources', () => {
    it('lists the current platform first, then the signed-in and accountless ones, then the library sources that can be searched', () => {
        expect(resolveSearchSources({ providers, activeProviderId: 'netease', hasLocalSongs: true, navidromeReady: true }))
            .toEqual(['netease', 'kugou', 'folium.mod.source', 'local', 'navidrome']);
    });

    it('lists the current platform even when nobody is signed in to it', () => {
        expect(resolveSearchSources({ providers, activeProviderId: 'qq', hasLocalSongs: false, navidromeReady: false }))
            .toEqual(['qq', 'netease', 'kugou', 'folium.mod.source']);
    });

    it('leaves out the local library without songs and Navidrome that is not set up', () => {
        const sources = resolveSearchSources({ providers, activeProviderId: 'kugou', hasLocalSongs: false, navidromeReady: false });
        expect(sources).not.toContain('local');
        expect(sources).not.toContain('navidrome');
        // A platform that is not signed in, or not configured, is not offered.
        expect(sources).not.toContain('qq');
        expect(sources).not.toContain('spotify');
    });

    // A Folium 2 source without search@1 (S4 desktop test: its tab opened on no results): not listed, not even as the
    // current platform.
    it('leaves out a platform that has no search, the current one too', () => {
        const canSearch = (providerId: string) => providerId !== 'folium.mod.source' && providerId !== 'qq';
        expect(resolveSearchSources({ providers, activeProviderId: 'netease', hasLocalSongs: true, navidromeReady: false, canSearch }))
            .toEqual(['netease', 'kugou', 'local']);
        expect(resolveSearchSources({ providers, activeProviderId: 'qq', hasLocalSongs: false, navidromeReady: false, canSearch }))
            .toEqual(['netease', 'kugou']);
    });
});

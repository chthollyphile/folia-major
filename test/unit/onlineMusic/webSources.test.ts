import { describe, expect, it } from 'vitest';
import { WEB_SOURCES, registerWebSources } from '@/services/onlineMusic/web';
import { getOnlineMusicProvider, listOnlineMusicProviders } from '@/services/onlineMusic/providerRegistry';

// The web build's sources (Folium 2.0 plan §8): registerWebSources() registers netease, kugou and qq, in the
// registry's order, each the provider its web/<id>.ts makes.

describe('registerWebSources', () => {
    it('lists the three platforms the web build has, and no desktop-only one', () => {
        expect(WEB_SOURCES.map((source) => source.id)).toEqual(['netease', 'kugou', 'qq']);
    });

    it('registers each web source under its id', () => {
        expect(registerWebSources()).toEqual(['netease', 'kugou', 'qq']);
        for (const source of WEB_SOURCES) {
            const provider = getOnlineMusicProvider(source.id);
            expect(provider?.id).toBe(source.id);
        }
        const order = listOnlineMusicProviders().map((provider) => provider.id).filter((id) => ['netease', 'kugou', 'qq'].includes(id));
        expect(order).toEqual(['netease', 'kugou', 'qq']);
    });
});

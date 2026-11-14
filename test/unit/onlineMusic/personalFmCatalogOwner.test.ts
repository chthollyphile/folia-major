// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { omni } from '@/services/onlineMusic/omni';
import { getOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { DEFAULT_PERSONAL_FM_CATALOG, EMPTY_PERSONAL_FM_CATALOG } from '@/services/onlineMusic/fmModes';

// test/unit/onlineMusic/personalFmCatalogOwner.test.ts
// Folium 2.0 member matrix §7 item 10: NetEase's FM modes and scenes are NetEase's own answer
// (neteaseProvider's getPersonalFmCatalog), no longer omni's default for every platform; a platform with no
// catalogue of its own has none. With all nine there, the catalogue each platform shows is what it was.

describe('the Personal FM catalogue and its owner', () => {
    it('is NetEase\'s own answer for NetEase, the same table as before', async () => {
        expect(getOnlineMusicProvider('netease')?.recommendations?.getPersonalFmCatalog).toBeTypeOf('function');
        await expect(omni.getPersonalFmCatalog('netease')).resolves.toBe(DEFAULT_PERSONAL_FM_CATALOG);
        // NetEase has no extra radios: a station is none of its own.
        await expect(omni.getPersonalFmStationCatalog('netease', 'radio')).rejects.toMatchObject({ code: 'unsupported' });
    });

    it('is empty for a platform without a catalogue of its own, where it used to be NetEase\'s', async () => {
        expect(getOnlineMusicProvider('kugou')?.recommendations?.getPersonalFmCatalog).toBeUndefined();
        await expect(omni.getPersonalFmCatalog('kugou')).resolves.toEqual(EMPTY_PERSONAL_FM_CATALOG);
        // Such a platform declares no FM modes, so nothing showed its catalogue before either.
        expect(omni.getProviderCapabilities('kugou').personalFmModes).toBeFalsy();
    });

    it('is empty, not an error, for a platform that is not registered (no platform at all)', async () => {
        await expect(omni.getPersonalFmCatalog('not-registered-source')).resolves.toEqual(EMPTY_PERSONAL_FM_CATALOG);
    });

    it('stays QQ\'s own answer for QQ (its Personal FM keeps the default table it always gave)', async () => {
        await expect(omni.getPersonalFmCatalog('qq')).resolves.toBe(DEFAULT_PERSONAL_FM_CATALOG);
    });
});

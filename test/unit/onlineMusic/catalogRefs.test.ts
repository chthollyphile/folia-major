import { describe, expect, it } from 'vitest';
import type { UnifiedSong } from '@/types';
import {
    canResolveSongCatalogRef,
    resolveSongCatalogRef,
} from '@/services/onlineMusic/catalogRefs';

const onlineSongWithoutCatalogMetadata = {
    sourceRef: { kind: 'online', providerId: 'missing-provider' },
} as unknown as UnifiedSong;

describe('online catalog references', () => {
    it('does not throw when deployed provider data omits album metadata', async () => {
        expect(canResolveSongCatalogRef(
            onlineSongWithoutCatalogMetadata,
            'album',
            undefined,
        )).toBe(false);

        await expect(resolveSongCatalogRef(
            onlineSongWithoutCatalogMetadata,
            'album',
            undefined,
        )).resolves.toBeNull();
    });
});

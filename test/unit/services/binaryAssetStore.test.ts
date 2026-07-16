import { afterEach, describe, expect, it, vi } from 'vitest';
import { readCoverAsset } from '@/services/binaryAssetStore';

// test/unit/services/binaryAssetStore.test.ts
// Verifies malformed Electron file-cache payloads are removed instead of reaching object URL consumers.

describe('binaryAssetStore', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('deletes an Electron cover payload with an invalid MIME descriptor', async () => {
        const removeCoverCache = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('window', {
            electron: {
                getCoverCache: vi.fn().mockResolvedValue({
                    found: true,
                    data: new Uint8Array([1, 2, 3]),
                    mimeType: 'application/json',
                }),
                saveCoverCache: vi.fn(),
                removeCoverCache,
            },
        });

        await expect(readCoverAsset('cover_local_bad')).resolves.toBeNull();
        expect(removeCoverCache).toHaveBeenCalledWith('cover_local_bad');
    });
});

import { describe, expect, it } from 'vitest';
import {
    SONNET_GEO_VARIANT_COUNT,
    resolveSonnetGeoVariant,
} from '@/components/visualizer/sonnet/sonnetSpatialMgGeometry';

// test/unit/visualizer/sonnetSpatialMg.test.ts
// Locks the expanded cuboid recipes into Sonnet's existing single MG scene collection.
describe('Sonnet spatial MG variants', () => {
    it('extends the original fourteen-scene collection without a second layer family', () => {
        expect(SONNET_GEO_VARIANT_COUNT).toBe(18);
        expect(Array.from({ length: 18 }, (_, seed) => resolveSonnetGeoVariant(seed)))
            .toEqual(Array.from({ length: 18 }, (_, seed) => seed));
    });

    it('keeps selection deterministic and safe for negative seeds', () => {
        for (let seed = -24; seed <= 24; seed += 1) {
            const variant = resolveSonnetGeoVariant(seed);
            expect(variant).toBe(resolveSonnetGeoVariant(seed));
            expect(variant).toBeGreaterThanOrEqual(0);
            expect(variant).toBeLessThan(SONNET_GEO_VARIANT_COUNT);
        }
    });
});

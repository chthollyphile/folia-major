import { describe, expect, it } from 'vitest';
import { omni } from '@/services/onlineMusic/omni';
import { listOnlineMusicProviders } from '@/services/onlineMusic/providerRegistry';
import { platformLogo } from '@/components/login/platformLogo';

// test/unit/login/platformLogo.test.ts
// A platform names its logo in `mark.logoKey`; the sign-in window looks that name up in
// src/assets/folia-login-icon/. A name with no file is not an error: the mark falls back to its
// letter. These pin that every declared logo is actually there, and that an unknown name is empty.

describe('platform logos', () => {
    it('finds a file for every logo a platform declares', () => {
        const declared = listOnlineMusicProviders()
            .map(provider => ({ id: provider.id, logoKey: omni.getProviderMark(provider.id)?.logoKey }))
            .filter((provider): provider is { id: string; logoKey: string } => Boolean(provider.logoKey));
        expect(declared.length).toBeGreaterThan(0);
        expect(declared.filter(provider => !platformLogo(provider.logoKey)).map(provider => provider.id)).toEqual([]);
    });

    it('answers nothing for a name that has no file', () => {
        expect(platformLogo('a-logo-that-is-not-there')).toBe('');
    });
});

import { describe, expect, it } from 'vitest';
import { resolveStoredAudioQuality } from '@/stores/useSettingsUiStore';

// test/unit/settings/audioQualityMigration.test.ts

describe('audio quality migration', () => {
    it('maps the old NetEase exhigh preference to provider-neutral high', () => {
        expect(resolveStoredAudioQuality('exhigh')).toBe('high');
        expect(resolveStoredAudioQuality('high')).toBe('high');
    });

    it.each(['standard', 'lossless', 'hires'] as const)('preserves %s', quality => {
        expect(resolveStoredAudioQuality(quality)).toBe(quality);
    });
});

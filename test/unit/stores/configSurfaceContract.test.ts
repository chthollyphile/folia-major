import { describe, expect, it } from 'vitest';
import { buildSyncedVisualSettings, readSyncableSettingsState } from '@/services/sync/settingsSnapshot';
import { buildVisualSettingsConfig } from '@/services/obs/visualSettingsConfig';

// test/unit/stores/configSurfaceContract.test.ts
// Locks the two documents that carry a listener's settings off this machine.
//
// A field dropped from either one is silent: sync keeps working, the shortcode still decodes, and
// the setting simply stops travelling. Nothing else in the suite would notice — which is why the
// store split was verified by diffing these key sets by hand at every step. This does it instead.
//
// These assert the *shape* of the produced document, not the source text, so they stay honest
// through a refactor that moves where each field is read from.

describe('config surface contract', () => {
    it('keeps every field of the synced visual settings document', () => {
        const document = buildSyncedVisualSettings(readSyncableSettingsState());

        expect(Object.keys(document).sort()).toMatchSnapshot();
    });

    it('keeps every field of the exportable visual config', () => {
        const config = buildVisualSettingsConfig();

        expect(Object.keys(config).sort()).toMatchSnapshot();
    });
});

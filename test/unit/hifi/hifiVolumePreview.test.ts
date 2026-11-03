import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// test/unit/hifi/hifiVolumePreview.test.ts
// The volume a slider previews while it is dragged reaches mpv on the HiFi route with software volume
// on: App's handlePreviewVolume hands it to hifiEngine.configure through selectHifiEngineConfig (the
// engine skips a config it already has). Without it the drag was silent on HiFi, and only the release
// changed the level. Read from App.tsx: App cannot be mounted in a unit test.

const app = fs.readFileSync(path.resolve(__dirname, '../../../src/App.tsx'), 'utf8');
const start = app.indexOf('const handlePreviewVolume = useCallback(');
const preview = app.slice(start, app.indexOf('\n    }, [', start) + 40);

describe('App handlePreviewVolume on the HiFi route', () => {
    it('is found', () => {
        expect(start).toBeGreaterThan(-1);
    });

    it('configures mpv with the previewed volume and the mute, only with software volume on the HiFi route', () => {
        expect(preview).toMatch(/const hifiSettings = useHifiSettingsStore\.getState\(\);/);
        expect(preview).toMatch(/if \(isHifiRoute\(\) && hifiSettings\.softwareVolume\) \{/);
        expect(preview).toMatch(/hifiEngine\.configure\(selectHifiEngineConfig\(hifiSettings, nextVolume, isMuted\)\)/);
        // The Web engine's gain still follows the drag.
        expect(preview).toMatch(/syncOutputGain\(nextVolume, 0\.015\);/);
    });

    it('reads the mute it was built with', () => {
        expect(preview).toMatch(/\}, \[isMuted, syncOutputGain\]\);/);
    });

    it('imports what it calls', () => {
        expect(app).toMatch(/import \{ hifiEngine \} from '\.\/services\/hifi\/hifiEngine';/);
        expect(app).toMatch(/import \{ selectHifiEngineConfig, useHifiSettingsStore \} from '\.\/stores\/useHifiSettingsStore';/);
    });
});

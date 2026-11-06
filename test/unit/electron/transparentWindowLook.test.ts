import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// The window look must match what createWindow() passed to BrowserWindow before the in-place switch.
const require = createRequire(import.meta.url);
const { transparentWindowLook } = require('../../../electron/transparentWindowLook.cjs');

describe('transparentWindowLook', () => {
    it('is opaque with a shadow when transparency is off', () => {
        expect(transparentWindowLook(false, false, 'darwin')).toEqual({
            backgroundColor: '#09090b',
            hasShadow: true,
            vibrancy: undefined,
            backgroundMaterial: undefined,
        });
    });

    it('lets native blur through a clear background only while opaque', () => {
        expect(transparentWindowLook(false, true, 'darwin')).toEqual({
            backgroundColor: '#00000000',
            hasShadow: true,
            vibrancy: 'fullscreen-ui',
            backgroundMaterial: undefined,
        });
        expect(transparentWindowLook(false, true, 'win32')).toMatchObject({
            vibrancy: undefined,
            backgroundMaterial: 'acrylic',
        });
        expect(transparentWindowLook(true, true, 'darwin')).toMatchObject({ vibrancy: undefined });
    });

    it('drops the shadow and any blur when transparent', () => {
        expect(transparentWindowLook(true, false, 'darwin')).toEqual({
            backgroundColor: '#00000000',
            hasShadow: false,
            vibrancy: undefined,
            backgroundMaterial: undefined,
        });
    });
});

import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The one display-media handler decides between the video export's recording and the external
// route's system-sound spectrum; these are the branches both features rely on.
const require = createRequire(import.meta.url);
const {
    DISPLAY_MEDIA_ROUTE_DENY,
    DISPLAY_MEDIA_ROUTE_SPECTRUM,
    DISPLAY_MEDIA_ROUTE_VIDEO_EXPORT,
    SPECTRUM_ARM_TTL_MS,
    createSpectrumArm,
    decideDisplayMediaRoute,
} = require('../../../electron/displayMediaRoute.cjs') as {
    DISPLAY_MEDIA_ROUTE_DENY: string;
    DISPLAY_MEDIA_ROUTE_SPECTRUM: string;
    DISPLAY_MEDIA_ROUTE_VIDEO_EXPORT: string;
    SPECTRUM_ARM_TTL_MS: number;
    createSpectrumArm: (options?: { onLapse?: (() => void) | null }) => {
        arm: () => void;
        disarm: () => boolean;
        spend: () => boolean;
        isArmed: () => boolean;
    };
    decideDisplayMediaRoute: (facts: {
        trusted: boolean;
        videoExportActive: boolean;
        spectrumCaptureArmed: boolean;
        audioRequested: boolean;
        platform: string;
    }) => string;
};

const facts = (overrides: Partial<Parameters<typeof decideDisplayMediaRoute>[0]> = {}) => ({
    trusted: true,
    videoExportActive: false,
    spectrumCaptureArmed: false,
    audioRequested: true,
    platform: 'win32',
    ...overrides,
});

describe('displayMediaRoute', () => {
    it('refuses anything that is not the main window, armed or not', () => {
        expect(decideDisplayMediaRoute(facts({ trusted: false }))).toBe(DISPLAY_MEDIA_ROUTE_DENY);
        expect(decideDisplayMediaRoute(facts({ trusted: false, spectrumCaptureArmed: true }))).toBe(DISPLAY_MEDIA_ROUTE_DENY);
        expect(decideDisplayMediaRoute(facts({ trusted: false, videoExportActive: true }))).toBe(DISPLAY_MEDIA_ROUTE_DENY);
    });

    it('grants the machine\'s sound to an armed audio request on Windows', () => {
        expect(decideDisplayMediaRoute(facts({ spectrumCaptureArmed: true }))).toBe(DISPLAY_MEDIA_ROUTE_SPECTRUM);
    });

    it('refuses the spectrum when the renderer did not arm it', () => {
        expect(decideDisplayMediaRoute(facts())).toBe(DISPLAY_MEDIA_ROUTE_DENY);
    });

    it('refuses the spectrum to a request that asked for no audio', () => {
        expect(decideDisplayMediaRoute(facts({ spectrumCaptureArmed: true, audioRequested: false })))
            .toBe(DISPLAY_MEDIA_ROUTE_DENY);
    });

    it('refuses the spectrum off Windows, where loopback Streams does not exist', () => {
        for (const platform of ['darwin', 'linux', 'freebsd']) {
            expect(decideDisplayMediaRoute(facts({ spectrumCaptureArmed: true, platform })))
                .toBe(DISPLAY_MEDIA_ROUTE_DENY);
        }
    });

    it('keeps the export recording when an export holds the handler', () => {
        expect(decideDisplayMediaRoute(facts({ videoExportActive: true }))).toBe(DISPLAY_MEDIA_ROUTE_VIDEO_EXPORT);
    });

    it('never hands the export a stream of the machine\'s sound', () => {
        expect(decideDisplayMediaRoute(facts({ spectrumCaptureArmed: true, videoExportActive: true })))
            .toBe(DISPLAY_MEDIA_ROUTE_VIDEO_EXPORT);
    });
});
describe('createSpectrumArm', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('buys one call per arm, and the call spends it', () => {
        vi.useFakeTimers();
        const arm = createSpectrumArm();

        expect(arm.isArmed()).toBe(false);
        expect(arm.spend()).toBe(false);

        arm.arm();
        expect(arm.isArmed()).toBe(true);
        expect(arm.spend()).toBe(true);
        expect(arm.isArmed()).toBe(false);
        // The call that spent it is the only one it bought.
        expect(arm.spend()).toBe(false);
    });

    it('lapses by itself when the call it bought never comes', () => {
        vi.useFakeTimers();
        const lapsed = vi.fn();
        const arm = createSpectrumArm({ onLapse: lapsed });

        arm.arm();
        vi.advanceTimersByTime(SPECTRUM_ARM_TTL_MS - 1);
        expect(arm.isArmed()).toBe(true);
        expect(lapsed).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(arm.isArmed()).toBe(false);
        expect(lapsed).toHaveBeenCalledOnce();
        expect(arm.spend()).toBe(false);
    });

    it('clears an arm the page took with it, without waiting for the lapse', () => {
        vi.useFakeTimers();
        const lapsed = vi.fn();
        const arm = createSpectrumArm({ onLapse: lapsed });

        arm.arm();
        expect(arm.disarm()).toBe(true);
        expect(arm.isArmed()).toBe(false);
        expect(arm.disarm()).toBe(false);

        vi.advanceTimersByTime(SPECTRUM_ARM_TTL_MS * 2);
        expect(lapsed).not.toHaveBeenCalled();
    });

    it('keeps one lapse timer however often it is armed', () => {
        vi.useFakeTimers();
        const lapsed = vi.fn();
        const arm = createSpectrumArm({ onLapse: lapsed });

        arm.arm();
        vi.advanceTimersByTime(SPECTRUM_ARM_TTL_MS - 1);
        arm.arm();
        vi.advanceTimersByTime(SPECTRUM_ARM_TTL_MS - 1);

        // The first timer was replaced, so the arm is still held one tick short of the second lapse.
        expect(arm.isArmed()).toBe(true);
        expect(lapsed).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(lapsed).toHaveBeenCalledOnce();
    });
});

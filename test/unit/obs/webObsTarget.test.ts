import { beforeEach, describe, expect, it } from 'vitest';
import { resolveWebObsTarget, selectWebObsSource } from '@/utils/webObsTarget';
import { useSettingsUiStore } from '@/stores/useSettingsUiStore';

// test/unit/obs/webObsTarget.test.ts
// Web stage source derivation for the copy-OBS-URL buttons: PlayerCap takes precedence over
// Now Playing, and PlayerCap URLs carry only its non-default connection params.

describe('selectWebObsSource', () => {
    it('prefers playercap, then now-playing, else null', () => {
        expect(selectWebObsSource({ enablePlayerCapStage: true, enableNowPlayingStage: false })).toBe('playercap');
        expect(selectWebObsSource({ enablePlayerCapStage: false, enableNowPlayingStage: true })).toBe('now-playing');
        expect(selectWebObsSource({ enablePlayerCapStage: true, enableNowPlayingStage: true })).toBe('playercap');
        expect(selectWebObsSource({ enablePlayerCapStage: false, enableNowPlayingStage: false })).toBeNull();
    });
});

describe('resolveWebObsTarget', () => {
    beforeEach(() => {
        useSettingsUiStore.setState({
            enableNowPlayingStage: false,
            enablePlayerCapStage: false,
            playerCapHost: 'localhost:8765',
            playerCapPlayer: '',
            playerCapTimeBasis: 'play_time',
            playerCapSticky: true,
        });
    });

    it('returns null when no web stage source is on', () => {
        expect(resolveWebObsTarget()).toBeNull();
    });

    it('returns a bare now-playing target', () => {
        useSettingsUiStore.setState({ enableNowPlayingStage: true });
        expect(resolveWebObsTarget()).toEqual({ source: 'now-playing', host: '', extra: {} });
    });

    it('omits playercap params equal to the OBS defaults', () => {
        useSettingsUiStore.setState({ enablePlayerCapStage: true });
        expect(resolveWebObsTarget()).toEqual({ source: 'playercap', host: '', extra: {} });
    });

    it('carries non-default playercap host/nxpcPlayer/nxpcBasis/nxpcSticky', () => {
        useSettingsUiStore.setState({
            enablePlayerCapStage: true,
            playerCapHost: '192.168.1.9:8765',
            playerCapPlayer: 'foobar2000',
            playerCapTimeBasis: 'timestamp',
            playerCapSticky: false,
        });
        expect(resolveWebObsTarget()).toEqual({
            source: 'playercap',
            host: '192.168.1.9:8765',
            extra: { nxpcPlayer: 'foobar2000', nxpcBasis: 'timestamp', nxpcSticky: '0' },
        });
    });
});

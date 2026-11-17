// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { useAudioSettingsStore } from '@/stores/useAudioSettingsStore';
import { nextLoopMode, shownLoopMode } from '@/utils/loopMode';

// test/unit/playback/fmLoopMode.test.ts
// The repeat button in Personal FM (#1225). Single loop works there as on any queue; loop-all has no
// queue start to go round to, so it shows as off and the button's cycle skips it there.

const initialAudio = useAudioSettingsStore.getState();

beforeEach(() => {
    useAudioSettingsStore.setState(initialAudio, true);
});

describe('the loop mode shown in Personal FM', () => {
    it('keeps single loop, shows loop-all as off, and leaves every mode alone outside FM', () => {
        expect(shownLoopMode('one', true)).toBe('one');
        expect(shownLoopMode('all', true)).toBe('off');
        expect(shownLoopMode('off', true)).toBe('off');
        for (const mode of ['off', 'all', 'one'] as const) expect(shownLoopMode(mode, false)).toBe(mode);
    });
});

describe('a press on the repeat button', () => {
    it('cycles off, all, one outside FM', () => {
        expect(nextLoopMode('off', false)).toBe('all');
        expect(nextLoopMode('all', false)).toBe('one');
        expect(nextLoopMode('one', false)).toBe('off');
    });

    it('goes between off and single loop in FM, stepping on from what it shows', () => {
        expect(nextLoopMode('off', true)).toBe('one');
        expect(nextLoopMode('all', true)).toBe('one');
        expect(nextLoopMode('one', true)).toBe('off');
    });

    it('stores the mode it lands on, in FM as outside it', () => {
        useAudioSettingsStore.setState({ loopMode: 'off' });
        useAudioSettingsStore.getState().handleToggleLoopMode(true);
        expect(useAudioSettingsStore.getState().loopMode).toBe('one');
        useAudioSettingsStore.getState().handleToggleLoopMode(false);
        expect(useAudioSettingsStore.getState().loopMode).toBe('off');
        useAudioSettingsStore.getState().handleToggleLoopMode();
        expect(useAudioSettingsStore.getState().loopMode).toBe('all');
    });
});

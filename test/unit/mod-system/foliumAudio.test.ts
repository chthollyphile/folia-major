import { describe, expect, it } from 'vitest';
import { motionValue } from 'framer-motion';
import { createFoliumAudio, type FoliumAudioSource } from '@/mods/folium/audio';
import type { AudioBands } from '@/types';

// test/unit/mod-system/foliumAudio.test.ts
// ctx.audio gives mods one 0..1 scale although the host feeds two:
// the live analyser writes 0..255, previews a synthetic 0..1 signal.

const makeBands = (value: number, spectrum = new Uint8Array(0)): AudioBands => ({
    bass: motionValue(value),
    lowMid: motionValue(value),
    mid: motionValue(value),
    vocal: motionValue(value),
    treble: motionValue(value),
    spectrum: motionValue(spectrum),
});

describe('createFoliumAudio', () => {
    it('maps the live 0..255 analyser onto 0..1', () => {
        const audio = createFoliumAudio(() => ({ audioPower: motionValue(127.5), audioBands: makeBands(255) }));
        expect(audio.getPower()).toBeCloseTo(0.5);
        expect(audio.getBands()).toEqual({ bass: 1, lowMid: 1, mid: 1, vocal: 1, treble: 1 });
    });

    it('passes the synthetic 0..1 preview signal through', () => {
        const audio = createFoliumAudio(() => ({ audioPower: motionValue(0.3), audioBands: makeBands(0.2) }));
        expect(audio.getPower()).toBeCloseTo(0.3);
        expect(audio.getBands().bass).toBeCloseTo(0.2);
    });

    it('reads silence and a missing analyser as 0, and an empty spectrum as null', () => {
        expect(createFoliumAudio(() => ({})).getPower()).toBe(0);
        expect(createFoliumAudio(() => ({})).getBands()).toEqual({ bass: 0, lowMid: 0, mid: 0, vocal: 0, treble: 0 });
        expect(createFoliumAudio(() => ({ audioBands: makeBands(0) })).getSpectrum()).toBeNull();
        const bins = new Uint8Array([1, 2, 3]);
        expect(createFoliumAudio(() => ({ audioBands: makeBands(0, bins) })).getSpectrum()).toBe(bins);
    });

    it('reads the current source on every call and refreshes one bands object in place', () => {
        let source: FoliumAudioSource = { audioBands: makeBands(0) };
        const audio = createFoliumAudio(() => source);
        const first = audio.getBands();
        source = { audioBands: makeBands(0.5) };
        const second = audio.getBands();
        expect(second).toBe(first);
        expect(second.mid).toBeCloseTo(0.5);
    });
});

import { describe, expect, it } from 'vitest';
import {
    cycleSubtitleContentMode,
    resolveLyricAlternateText,
    resolveLyricSubtitleTracks,
    resolveSingleTrackSubtitleMode,
} from '@/utils/lyrics/alternateText';
import { resolveFoliumDisplay } from '@/mods/folium/registries/stageContext';
import { showsLatticeTranslation } from '@/components/app/lattice/lyrics/latticeLyricLayout';
import type { LatticeLyricInput } from '@/components/app/lattice/lyrics/types';
import type { Line } from '@/types';

// test/unit/lyrics/alternateText.test.ts
// Pins how the subtitle content modes pick rows: 'both' stacks romanization over translation on the
// shared bottom subtitle, while Monet / Pendolo / Lattice / Still (own lyric layout) collapse it to translation.

const source = (patch: Partial<Line> = {}): Pick<Line, 'translation' | 'romanization' | 'alternateTexts'> => ({
    translation: '早安',
    romanization: 'ohayou',
    ...patch,
});

describe('resolveLyricSubtitleTracks', () => {
    it('returns romanization above translation when both exist', () => {
        expect(resolveLyricSubtitleTracks(source(), 'both')).toEqual([
            { role: 'romanization', text: 'ohayou' },
            { role: 'translation', text: '早安' },
        ]);
    });

    it('returns only romanization when the translation is missing', () => {
        expect(resolveLyricSubtitleTracks(source({ translation: undefined }), 'both')).toEqual([
            { role: 'romanization', text: 'ohayou' },
        ]);
    });

    it('returns only translation when the romanization is missing', () => {
        expect(resolveLyricSubtitleTracks(source({ romanization: '  ' }), 'both')).toEqual([
            { role: 'translation', text: '早安' },
        ]);
    });

    it('returns nothing when neither exists, and for none / missing source', () => {
        expect(resolveLyricSubtitleTracks(source({ translation: undefined, romanization: undefined }), 'both')).toEqual([]);
        expect(resolveLyricSubtitleTracks(source(), 'none')).toEqual([]);
        expect(resolveLyricSubtitleTracks(null, 'both')).toEqual([]);
    });

    it('reads alternate tracks when the direct fields are absent', () => {
        const tracks = resolveLyricSubtitleTracks(source({
            translation: undefined,
            romanization: undefined,
            alternateTexts: [
                { role: 'translation', text: ' good morning ' },
                { role: 'romanization', text: 'ohayou' },
            ],
        }), 'both');

        expect(tracks.map(track => track.text)).toEqual(['ohayou', 'good morning']);
    });

    it('keeps single-source modes on their own track without falling back', () => {
        expect(resolveLyricSubtitleTracks(source(), 'translation')).toEqual([{ role: 'translation', text: '早安' }]);
        expect(resolveLyricSubtitleTracks(source(), 'romanization')).toEqual([{ role: 'romanization', text: 'ohayou' }]);
        expect(resolveLyricSubtitleTracks(source({ romanization: undefined }), 'romanization')).toEqual([]);
    });

    it('drops unreadable rows individually and shows identical text once', () => {
        const readable = (text: string) => /[\p{L}\p{N}]/u.test(text);

        expect(resolveLyricSubtitleTracks(source({ romanization: '//' }), 'both', readable)).toEqual([
            { role: 'translation', text: '早安' },
        ]);
        expect(resolveLyricSubtitleTracks(source({ translation: 'ohayou' }), 'both')).toEqual([
            { role: 'romanization', text: 'ohayou' },
        ]);
    });
});

describe('single-track fallback for modes with their own lyric layout', () => {
    it('collapses both to translation and leaves the other modes alone', () => {
        expect(resolveSingleTrackSubtitleMode('both')).toBe('translation');
        expect(resolveSingleTrackSubtitleMode('romanization')).toBe('romanization');
        expect(resolveSingleTrackSubtitleMode('translation')).toBe('translation');
        expect(resolveSingleTrackSubtitleMode('none')).toBe('none');
    });

    it('resolves a single text under both so Monet, Pendolo and the harmony overlay never see a blank or crash', () => {
        expect(resolveLyricAlternateText(source(), 'both')).toBe('早安');
        expect(resolveLyricAlternateText(source({ translation: undefined }), 'both')).toBeNull();
        expect(resolveLyricAlternateText(null, 'both')).toBeNull();
    });

    it('hands Folium mods a single-track mode, keeping the public contract unchanged', () => {
        expect(resolveFoliumDisplay({ subtitleContentMode: 'both' }).subtitleContentMode).toBe('translation');
        expect(resolveFoliumDisplay({ subtitleContentMode: 'romanization' }).subtitleContentMode).toBe('romanization');
        expect(resolveFoliumDisplay({}).subtitleContentMode).toBe('translation');
    });

    it('keeps the Lattice translation row enabled under both', () => {
        const latticeInput = (subtitleContentMode: LatticeLyricInput['subtitleContentMode']) => ({ subtitleContentMode }) as LatticeLyricInput;

        expect(showsLatticeTranslation(latticeInput('both'))).toBe(true);
        expect(showsLatticeTranslation(latticeInput('none'))).toBe(false);
    });
});

describe('cycleSubtitleContentMode', () => {
    it('walks translation, romanization, both and back', () => {
        expect(cycleSubtitleContentMode('translation')).toBe('romanization');
        expect(cycleSubtitleContentMode('romanization')).toBe('both');
        expect(cycleSubtitleContentMode('both')).toBe('translation');
        expect(cycleSubtitleContentMode('none')).toBe('translation');
    });
});

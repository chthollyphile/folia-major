import { describe, expect, it } from 'vitest';
import { DEFAULT_CLADDAGH_TUNING, DEFAULT_MONET_TUNING, type CladdaghTuning, type MonetTuning } from '@/types';
import monetTuning, { resolveMonetChromeVisibility, resolveStoredMonetTuning } from '@/components/visualizer/monet/tuning';
import claddaghTuning from '@/components/visualizer/claddagh/tuning';
import { compressConfig, decompressConfig } from '@/utils/appearanceCodec';

// test/unit/visualizer/monetLayoutOptions.test.ts
// #1124 的布局选项：莫奈的镜像、关闭肖像、自定义描述、描述与拖动按钮三态显示；回环的位置与翻译。

const mergeMonet = (held: MonetTuning, patch: Partial<MonetTuning>) => monetTuning.storage!.merge(held, patch);
const mergeCladdagh = (held: CladdaghTuning, patch: Partial<CladdaghTuning>) => claddaghTuning.storage!.merge(held, patch);

describe('Monet layout options (#1124)', () => {
    it('reads an older tuning as the original layout', () => {
        const read = resolveStoredMonetTuning({ showDescription: false, showPortraitDragHanger: true });
        expect(read.mirrorLayout).toBe(false);
        expect(read.customDescription).toBe('');
        expect(read.descriptionVisibility).toBe('hidden');
        expect(read.portraitHangerVisibility).toBe('auto');
    });

    it('keeps the portrait switched off, and drops a source it does not know', () => {
        expect(resolveStoredMonetTuning({ portraitSource: 'none' }).portraitSource).toBe('none');
        expect(resolveStoredMonetTuning({ portraitSource: 'bad' as never }).portraitSource).toBe('cover');
    });

    it('keeps the old switch equal to the three-way visibility', () => {
        const always = mergeMonet(DEFAULT_MONET_TUNING, { descriptionVisibility: 'always' });
        expect(always.descriptionVisibility).toBe('always');
        expect(always.showDescription).toBe(true);

        const hidden = mergeMonet(always, { descriptionVisibility: 'hidden' });
        expect(hidden.showDescription).toBe(false);

        // Turned back on from hidden by a value that is not hidden, over a held switch that is off.
        const back = mergeMonet(hidden, { descriptionVisibility: 'always' });
        expect(back.descriptionVisibility).toBe('always');
        expect(back.showDescription).toBe(true);
    });

    it('moves the visibility with a patch that sets only the old switch', () => {
        const always = mergeMonet(DEFAULT_MONET_TUNING, { portraitHangerVisibility: 'always' });
        const off = mergeMonet(always, { showPortraitDragHanger: false });
        expect(off.portraitHangerVisibility).toBe('hidden');
        const on = mergeMonet(off, { showPortraitDragHanger: true });
        expect(on.portraitHangerVisibility).toBe('auto');
        // On over a visible setting keeps it.
        expect(mergeMonet(always, { showPortraitDragHanger: true }).portraitHangerVisibility).toBe('always');
    });

    it('resolves a visibility from either field', () => {
        expect(resolveMonetChromeVisibility(undefined, undefined)).toBe('auto');
        expect(resolveMonetChromeVisibility('always', true)).toBe('always');
        expect(resolveMonetChromeVisibility('always', false)).toBe('hidden');
        expect(resolveMonetChromeVisibility('nope', true, 'hidden')).toBe('auto');
    });

    it('keeps a custom description short', () => {
        expect(resolveStoredMonetTuning({ customDescription: 'x'.repeat(500) }).customDescription).toHaveLength(120);
        expect(resolveStoredMonetTuning({ customDescription: 42 as never }).customDescription).toBe('');
    });

    it('carries the new settings through an appearance code', () => {
        const tuning: MonetTuning = {
            ...DEFAULT_MONET_TUNING,
            mirrorLayout: true,
            customDescription: 'Late night',
            descriptionVisibility: 'always',
            portraitHangerVisibility: 'hidden',
            showPortraitDragHanger: false,
        };
        const decoded = decompressConfig(compressConfig({ monetTuning: tuning })) as { monetTuning: Partial<MonetTuning> };
        const read = resolveStoredMonetTuning(decoded.monetTuning);
        expect(read.mirrorLayout).toBe(true);
        expect(read.customDescription).toBe('Late night');
        expect(read.descriptionVisibility).toBe('always');
        expect(read.portraitHangerVisibility).toBe('hidden');
    });
});

describe('Claddagh layout options (#1124)', () => {
    it('reads an older tuning with the ring centred and no translation', () => {
        const read = claddaghTuning.storage!.read({ focusScaleRatio: 0.8 });
        expect(read).toMatchObject({ positionX: 0, positionY: 0, showTranslation: false, translationScale: 1, translationLetterSpacingOffset: 0 });
    });

    it('keeps the position and the translation settings in range', () => {
        const merged = mergeCladdagh(DEFAULT_CLADDAGH_TUNING, {
            positionX: 90,
            positionY: -90,
            translationScale: 9,
            translationLetterSpacingOffset: -40,
            showTranslation: true,
        });
        expect(merged).toMatchObject({ positionX: 40, positionY: -40, translationScale: 2, translationLetterSpacingOffset: -5, showTranslation: true });
        // A patch without them keeps what is held.
        expect(mergeCladdagh(merged, { radiusScale: 1.2 })).toMatchObject({ positionX: 40, showTranslation: true });
    });
});

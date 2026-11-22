import { describe, expect, it } from 'vitest';
import { PERSONAL_FM_MODE_INFO, personalFmModes } from '@folia/folium-source-kit';
import { PERSONAL_FM_MODES } from '@/services/onlineMusic/fmModes';

// test/unit/sources/kitFmModes.test.ts
// The kit's standard personal FM modes (packages/folium-source-kit/src/fmModes.ts): a source names the modes it
// takes and gets them in the standard order with their keywords; the host's mode table is built on the same list.

describe('the kit\'s personal FM modes', () => {
    it('lists the modes asked for in the standard order, each named by the source', () => {
        const modes = personalFmModes(['SCENE_RCMD', 'DEFAULT', 'EXPLORE', 'FAMILIAR', 'NOT_A_MODE'], id => `mode:${id}`);
        expect(modes.map(mode => mode.id)).toEqual(['DEFAULT', 'FAMILIAR', 'EXPLORE', 'SCENE_RCMD']);
        expect(modes[0]).toEqual({ id: 'DEFAULT', label: 'mode:DEFAULT', keywords: ['moren', 'mr'] });
        // Each call hands out keyword lists of its own, the table's stay as they are.
        modes[0].keywords.push('x');
        expect(PERSONAL_FM_MODE_INFO[0].keywords).toEqual(['moren', 'mr']);
    });

    it('is the list the host\'s mode table is built on, with the host\'s keys', () => {
        expect(PERSONAL_FM_MODES).toEqual(PERSONAL_FM_MODE_INFO.map(info => ({
            id: info.id, labelKey: `personalFmMode.mode.${info.id}`, labelFallback: info.labelFallback, keywords: [...info.keywords],
        })));
        expect(PERSONAL_FM_MODES.map(mode => mode.id)).toEqual(['DEFAULT', 'FAMILIAR', 'EXPLORE', 'PUZZLE_MODE_RCMD', 'SCENE_RCMD']);
    });
});

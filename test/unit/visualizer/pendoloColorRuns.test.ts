import { describe, expect, it } from 'vitest';
import { buildPendoloColorRuns } from '@/components/visualizer/pendolo/pendoloColorRuns';

// test/unit/visualizer/pendoloColorRuns.test.ts

describe('Pendolo color runs', () => {
    it('keeps an uncoloured lyric as one text run', () => {
        const runs = buildPendoloColorRuns('椿をわたり', 0, new Map(), '#ffffff');

        expect(runs).toEqual([{ key: '0-#ffffff', text: '椿をわたり', color: '#ffffff' }]);
    });

    it('only splits at an actual resolved color boundary', () => {
        const runs = buildPendoloColorRuns('椿をわたり', 4, new Map([
            ['5', '#f06'],
            ['6', '#f06'],
        ]), '#ffffff');

        expect(runs.map(run => ({ text: run.text, color: run.color }))).toEqual([
            { text: '椿', color: '#ffffff' },
            { text: 'をわ', color: '#f06' },
            { text: 'たり', color: '#ffffff' },
        ]);
        expect(runs.map(run => run.text).join('')).toBe('椿をわたり');
    });
});

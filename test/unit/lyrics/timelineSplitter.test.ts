import { describe, expect, it } from 'vitest';
import { splitCombinedTimeline } from '@/utils/lyrics/timelineSplitter';

describe('timelineSplitter', () => {
    it('splits alternating bilingual line-level LRC into main and translation streams', () => {
        const combined = [
            '[00:12.428]ハロ窓を開けて小さく呟いた',
            '[00:12.428]你好 打开窗户轻声说道',
            '[00:17.798]ハワユ誰もいない部屋で一人',
            '[00:17.798]你好吗 独自在空无一人的房间里'
        ].join('\n');

        const { main, trans } = splitCombinedTimeline(combined);

        expect(main).toBe([
            '[00:12.428]ハロ窓を開けて小さく呟いた',
            '[00:17.798]ハワユ誰もいない部屋で一人'
        ].join('\n'));
        expect(trans).toBe([
            '[00:12.428]你好 打开窗户轻声说道',
            '[00:17.798]你好吗 独自在空无一人的房间里'
        ].join('\n'));
    });

    it('splits alternating enhanced LRC using the shared start timestamp heuristic', () => {
        const combined = [
            '[00:12.428]ハ[00:12.667]ロ[00:13.343]窓[00:13.548]を[00:13.747]開[00:14.073]け[00:14.449]て[00:15.019]小[00:15.426]さ[00:15.637]く[00:15.794]呟[00:16.024]い[00:16.500]た[00:16.986]',
            '[00:12.428]你好 打开窗户轻声说道[00:16.986]',
            '[00:17.798]<00:17.798>ハ<00:17.981>ワ<00:18.171>ユ<00:18.380>誰<00:18.528>も<00:18.801>い<00:19.060>な<00:19.463>い<00:20.056>部<00:20.282>屋<00:20.541>で<00:20.800>一<00:21.171>人<00:21.847>',
            '[00:17.798]<00:17.798>你好吗 独自在空无一人的房间里<00:21.847>'
        ].join('\n');

        const { main, trans } = splitCombinedTimeline(combined);

        expect(main).toContain('[00:12.428]ハ[00:12.667]ロ');
        expect(main).toContain('[00:17.798]<00:17.798>ハ<00:17.981>ワ');
        expect(trans).toContain('[00:12.428]你好 打开窗户轻声说道[00:16.986]');
        expect(trans).toContain('[00:17.798]<00:17.798>你好吗 独自在空无一人的房间里<00:21.847>');
    });

    it('does not split unrelated lyrics that only contain a single stream', () => {
        const singleStream = [
            '[00:12.428]ハロ窓を開けて小さく呟いた',
            '[00:17.798]ハワユ誰もいない部屋で一人',
            '[00:22.266]モーニン朝が来たよ'
        ].join('\n');

        const { main, trans } = splitCombinedTimeline(singleStream);

        expect(main).toBe(singleStream);
        expect(trans).toBe('');
    });
});

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { motionValue } from 'framer-motion';
import { describe, expect, it } from 'vitest';
import { GlowWord } from '@/components/visualizer/GlowWord';
import { DEFAULT_THEME } from '@/services/baseThemes';
import type { StrokeWriteSource } from '@/components/visualizer/fontStrokes/strokeWriteSource';
import type { Word } from '@/types';

// test/unit/visualizer/glowWordHandwriting.test.ts
// 流光 / 云阶的手写笔画开关：没有笔画来源时 GlowWord 的标记和原来一样；有来源时只有汉字 / 假名包成 inline-block span。

const render = (text: string, handwriting?: StrokeWriteSource | null) => {
    const word = { text, startTime: 10, endTime: 11 } as Word;
    const props = {
        word,
        config: { id: 'w0' },
        currentTime: motionValue(0),
        theme: DEFAULT_THEME,
        layoutVariants: {},
        bodyVariants: {},
        baseColor: '#ffffff',
        activeColor: '#ffcc00',
        renderProfile: { wordRevealMode: 'normal' } as never,
        fontSize: '40px',
        layoutStyle: {},
        ...(handwriting === undefined ? {} : { handwriting }),
    };
    return renderToStaticMarkup(React.createElement(GlowWord<{ id: string }>, props));
};

const source: StrokeWriteSource = { getStrokes: () => null, decisions: new Map() };

describe('GlowWord handwriting', () => {
    it('renders the same markup with no source, a null source, or a source on a word without CJK', () => {
        for (const text of ['永远', 'love', 'あい']) {
            expect(render(text, null)).toBe(render(text));
        }
        expect(render('love', source)).toBe(render('love'));
    });

    it('wraps only the CJK / kana graphemes when a source is given', () => {
        const markup = render('A永', source);
        // body: "A" stays text, 永 gets one inline-block span; glow: 永 gets wrapper + ink
        expect(markup.match(/<span style="display:inline-block">永<\/span>/g)).toHaveLength(2);
        expect(markup).toContain('<span style="display:inline-block"><span style="display:inline-block">永</span></span>');
        expect(markup).not.toContain('<span style="display:inline-block">A');
    });
});

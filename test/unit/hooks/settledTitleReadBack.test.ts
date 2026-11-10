// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

// test/unit/hooks/settledTitleReadBack.test.ts
// useSettledTitle fits a title before paint, then reads the box back once. A read-back that agrees
// must not render the title again: that extra render, set from an effect React runs right after a
// sync commit, was still pending when the queue wall's next pan update arrived, so during a fast pan
// every commit left work behind and React stopped the wall with "maximum update depth" (#185).

const fit = vi.hoisted(() => ({
    needsCorrection: vi.fn((): boolean => false),
    fitTitle: vi.fn((): string => 'Corrected'),
}));
vi.mock('@/utils/fitSettledTitle', () => ({
    TITLE_MAX_LINES: 3,
    fitTitleToWidth: (text: string) => text,
    readTitleMetrics: () => null,
    titleFitIsPredictable: () => true,
    titleFitNeedsCorrection: fit.needsCorrection,
    fitTitle: fit.fitTitle,
}));

const { useSettledTitle, TitleFitCacheContext } = await import('@/hooks/useSettledTitle');
const { createTitleFitCache } = await import('@/utils/settledTitleCache');

const metrics = { font: '22px serif', letterSpacing: 0, lineHeight: 26, fontSize: 22, width: 200 };
const readMetrics = () => metrics;

/** Mounts one title and returns every value it rendered. */
const mountTitle = (text: string) => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const rendered: string[] = [];
    const Title = () => {
        const { ref, value } = useSettledTitle(text, false, { readMetrics });
        rendered.push(value);
        return React.createElement('strong', { ref }, value);
    };
    const root = createRoot(document.body.appendChild(document.createElement('div')));
    act(() => root.render(React.createElement(TitleFitCacheContext.Provider, { value: createTitleFitCache() }, React.createElement(Title))));
    return { rendered, unmount: () => act(() => root.unmount()) };
};

afterEach(() => {
    fit.needsCorrection.mockReset().mockReturnValue(false);
    fit.fitTitle.mockReset().mockReturnValue('Corrected');
});

it('a read-back that agrees with the fit reads once and renders nothing more', () => {
    const { rendered, unmount } = mountTitle('Song 1');
    expect(fit.needsCorrection).toHaveBeenCalledTimes(1);
    // The first render, then the one the fit set before paint; no third for the confirmation.
    expect(rendered).toEqual(['Song 1', 'Song 1']);
    unmount();
});

it('a read-back that corrects the fit renders the correction once and does not read it again', () => {
    fit.needsCorrection.mockReturnValue(true);
    const { rendered, unmount } = mountTitle('A title the model got wrong');
    expect(fit.fitTitle).toHaveBeenCalledTimes(1);
    expect(fit.needsCorrection).toHaveBeenCalledTimes(1);
    expect(rendered.at(-1)).toBe('Corrected');
    expect(rendered.filter(value => value === 'Corrected')).toHaveLength(1);
    unmount();
});

it('a browser answer equal to the fit renders nothing more either', () => {
    fit.needsCorrection.mockReturnValue(true);
    fit.fitTitle.mockReturnValue('Song 2');
    const { rendered, unmount } = mountTitle('Song 2');
    expect(fit.fitTitle).toHaveBeenCalledTimes(1);
    expect(rendered).toEqual(['Song 2', 'Song 2']);
    unmount();
});

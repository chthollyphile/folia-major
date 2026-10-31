import React from 'react';

// src/components/app/home/explore/ExploreEdgeBlur.tsx
// One of the list's two edges, made of three blurs laid over one another: what comes up to an edge
// is blurred a little by the first, more by the second, and most by the third, so that it goes
// rather than being cut. It stands inside the list, which its own fade makes a backdrop root, so
// only the list's content is blurred: the page behind the list is left as it is.
// The band is twice as tall as the fade that edge has at the moment (nothing while the list stands
// still at that end). Each blur is given as the share of the band it is laid over, counted from the
// edge inwards: the deepest sits where the fade is still thinning the content, the lighter ones
// further in, and their ends overlap so that one becomes another without a line.

/** The three blurs an edge is made of, and the share of the band each of them is laid over. */
const EDGE_BLURS = [
    { blur: 10, stops: 'black 20%, transparent 55%' },
    { blur: 2, stops: 'black 50%, transparent 75%' },
    { blur: 0.8, stops: 'black 70%, transparent 100%' },
] as const;

export const ExploreEdgeBlur: React.FC<{ edge: 'top' | 'bottom' }> = ({ edge }) => {
    const top = edge === 'top';
    const towards = top ? 'to bottom' : 'to top';
    return (
        <div aria-hidden className={`fixed pointer-events-none sticky z-20 h-0 ${top ? 'top-0' : 'bottom-0'}`}>
            <div
                className={`absolute inset-x-0 ${top ? 'top-0' : 'bottom-0'}`}
                style={{ height: `calc(var(--ex-${edge}-fade, 0px) * 2)` }}
            >
                {EDGE_BLURS.map(({ blur, stops }) => {
                    const mask = `linear-gradient(${towards}, ${stops})`;
                    return (
                        <div
                            key={blur}
                            className="absolute inset-0"
                            style={{
                                backdropFilter: `blur(${blur}px)`,
                                WebkitBackdropFilter: `blur(${blur}px)`,
                                maskImage: mask,
                                WebkitMaskImage: mask,
                            }}
                        />
                    );
                })}
            </div>
        </div>
    );
};

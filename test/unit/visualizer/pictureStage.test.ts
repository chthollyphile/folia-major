// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ARRIVING_MARK, followCanvases, freezeStage, WAIT_MARK, watchStage } from '../../../src/components/visualizer/preview/frozenPicture';
import { PictureStageBoundary } from '../../../src/components/visualizer/preview/LivePicture';

// test/unit/visualizer/pictureStage.test.ts
// The stage a small picture draws a style on, where it goes wrong. A stage that stays empty, a
// stage that cannot be read, and a style that throws must each end the try: a try that never ends
// keeps the turn, and then no other picture on the page gets its image. None of this shows by
// looking: the pictures just stay empty, and only on a slow machine or with a mod's style.

const TIMERS = ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] as const;

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    // jsdom has no animations: none is running.
    Element.prototype.getAnimations = () => [];
    // jsdom lays nothing out: a box has a size unless its style says it has none.
    for (const side of ['offsetWidth', 'offsetHeight'] as const) {
        Object.defineProperty(HTMLElement.prototype, side, {
            configurable: true,
            get(this: HTMLElement) {
                return this.style.width === '0px' ? 0 : 10;
            },
        });
    }
});

describe('watching a stage', () => {
    let stage: HTMLElement;

    beforeEach(() => {
        vi.useFakeTimers({ toFake: [...TIMERS] });
        stage = document.createElement('div');
        document.body.appendChild(stage);
    });

    afterEach(() => {
        stage.remove();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    const watch = (until: 'drawn' | 'still' = 'still') => {
        const ends: string[] = [];
        const stop = watchStage(stage, until, end => ends.push(end));
        return { ends, stop };
    };

    it('ends as empty when the wait is over and the style\'s module is still loading', () => {
        stage.innerHTML = `<i ${WAIT_MARK}=""></i>`;
        const { ends } = watch();
        vi.advanceTimersByTime(3900);
        expect(ends).toEqual([]);
        vi.advanceTimersByTime(300);
        expect(ends).toEqual(['empty']);
        // Nothing of it is kept as an image.
        expect(freezeStage(stage)).toBeNull();
    });

    it('ends as empty when a style drawn with elements has put no word there', () => {
        stage.innerHTML = '<div><span></span></div>';
        const { ends } = watch();
        vi.advanceTimersByTime(4200);
        expect(ends).toEqual(['empty']);
        expect(freezeStage(stage)).toBeNull();
    });

    it('ends as shown for a background drawn with plain boxes that paint a picture or a gradient', () => {
        // The monet and the common background: no word, no canvas, no img, only boxes with a CSS background.
        stage.innerHTML = '<div><div style="background-image: linear-gradient(90deg, #111, #222)"></div></div>';
        const { ends } = watch('drawn');
        vi.advanceTimersByTime(200);
        expect(ends).toEqual(['shown']);
        expect(freezeStage(stage)).not.toBeNull();
        // Boxes that paint nothing are still nothing.
        stage.innerHTML = '<div><div style="background-image: none; background-color: #111"></div></div>';
        expect(freezeStage(stage)).toBeNull();
    });

    it('ends as shown once words are there, long before the wait is over', () => {
        stage.innerHTML = '<p>la la la</p>';
        const { ends } = watch('drawn');
        vi.advanceTimersByTime(200);
        expect(ends).toEqual(['shown']);
        expect(freezeStage(stage)?.textContent).toBe('la la la');
    });

    it('ends as failed, once, when reading the stage throws', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        Object.defineProperty(stage, 'firstElementChild', {
            get() {
                throw new Error('cannot be read');
            },
        });
        const { ends } = watch();
        vi.advanceTimersByTime(6000);
        expect(ends).toEqual(['failed']);
    });

    it('takes a canvas that cannot be read as drawn on, and reads the next one with a new copy', () => {
        const refuse = () => {
            throw new DOMException('tainted', 'SecurityError');
        };
        const context = { clearRect: () => {}, drawImage: () => {}, getImageData: vi.fn(refuse), imageSmoothingQuality: 'low' };
        const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never);
        const canvas = document.createElement('canvas');
        canvas.width = 8;
        canvas.height = 8;
        stage.appendChild(canvas);
        const { ends } = watch('drawn');
        vi.advanceTimersByTime(200);
        expect(ends).toEqual(['shown']);
        // Each read asked for a copy of its own: the one before was given up.
        expect(getContext.mock.calls.length).toBe(context.getImageData.mock.calls.length);
        expect(context.getImageData.mock.calls.length).toBeGreaterThan(0);
    });

    describe('with a canvas that has not drawn yet', () => {
        // What a canvas gives when it is read: one colour until its style has drawn on it.
        const paint = { drawn: false };
        const context = {
            clearRect: () => {},
            drawImage: () => {},
            getImageData: () => {
                const data = new Uint8ClampedArray(64 * 40 * 4);
                data[0] = paint.drawn ? 255 : 0;
                return { data };
            },
            imageSmoothingQuality: 'low',
        };
        const GRADIENT = 'background-image: linear-gradient(90deg, #111, #222)';

        beforeEach(() => {
            paint.drawn = false;
            vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never);
        });

        it('does not take painted boxes for the whole picture: it waits for the canvas, and takes the boxes when the wait is over', () => {
            // The common background: boxes with gradients, and canvases that draw the cover later.
            stage.innerHTML = `<div><div style="${GRADIENT}"></div><canvas width="8" height="8"></canvas></div>`;
            const { ends } = watch('drawn');
            vi.advanceTimersByTime(3900);
            expect(ends).toEqual([]);
            vi.advanceTimersByTime(300);
            expect(ends).toEqual(['shown']);
            expect(freezeStage(stage)).not.toBeNull();
        });

        it('takes the stage in the frame its canvas has drawn', () => {
            stage.innerHTML = `<div><div style="${GRADIENT}"></div><canvas width="8" height="8"></canvas></div>`;
            const { ends } = watch('drawn');
            vi.advanceTimersByTime(1500);
            expect(ends).toEqual([]);
            paint.drawn = true;
            vi.advanceTimersByTime(100);
            expect(ends).toEqual(['shown']);
        });

        it('still takes a stage with words after a second: a style may draw on its canvas only now and then', () => {
            stage.innerHTML = '<div><p>la la la</p><canvas width="8" height="8"></canvas></div>';
            const { ends } = watch('drawn');
            vi.advanceTimersByTime(900);
            expect(ends).toEqual([]);
            vi.advanceTimersByTime(300);
            expect(ends).toEqual(['shown']);
        });
    });

    describe('with a part that is still to come', () => {
        // The common background before its cover has arrived: boxes with gradients, and its root says so.
        const NOT_WHOLE = `<div ${ARRIVING_MARK}=""><div style="background-image: linear-gradient(90deg, #111, #222)"></div></div>`;

        it('is held back for as long as what is drawn says so, and taken as it stands when the wait is over', () => {
            stage.innerHTML = NOT_WHOLE;
            const { ends } = watch();
            vi.advanceTimersByTime(3900);
            expect(ends).toEqual([]);
            vi.advanceTimersByTime(300);
            expect(ends).toEqual(['shown']);
            expect(freezeStage(stage)).not.toBeNull();
        });

        it('is taken once the part has arrived, and not while its picture is there but still fading in', () => {
            stage.innerHTML = NOT_WHOLE;
            const { ends } = watch();
            vi.advanceTimersByTime(1500);
            expect(ends).toEqual([]);
            // The cover's layer is in the page, not yet seen.
            stage.firstElementChild!.insertAdjacentHTML('afterbegin', '<div style="opacity: 0"><img alt=""></div>');
            vi.advanceTimersByTime(1000);
            expect(ends).toEqual([]);
            stage.firstElementChild!.removeAttribute(ARRIVING_MARK);
            vi.advanceTimersByTime(700);
            expect(ends).toEqual(['shown']);
            expect(freezeStage(stage)?.querySelector('img')).not.toBeNull();
        });
    });

    it('takes a box of no size, and one that is not seen, as painting nothing', () => {
        for (const hidden of ['width: 0px', 'opacity: 0']) {
            stage.innerHTML = `<div><div style="background-image: linear-gradient(90deg, #111, #222); ${hidden}"></div></div>`;
            const { ends } = watch('drawn');
            vi.advanceTimersByTime(4200);
            expect(ends).toEqual(['empty']);
            expect(freezeStage(stage)).toBeNull();
        }
    });

    it('says nothing after it was stopped', () => {
        const { ends, stop } = watch();
        vi.advanceTimersByTime(1000);
        stop();
        vi.advanceTimersByTime(6000);
        expect(ends).toEqual([]);
    });
});

describe('a stage that is taken down', () => {
    /** A canvas that answers for its context as a browser does: one kind only, once it has one. */
    const canvasWith = (kind: 'webgl2' | 'webgl' | '2d' | null, lost = false) => {
        const canvas = document.createElement('canvas');
        const lose = vi.fn();
        const asked: string[] = [];
        let has = kind;
        canvas.getContext = ((want: string) => {
            asked.push(want);
            has ??= want as typeof kind;
            if (want !== has) {
                return null;
            }
            return want === '2d' ? {} : { isContextLost: () => lost, getExtension: () => ({ loseContext: lose }) };
        }) as never;
        return { canvas, lose, asked };
    };

    it('gives back the WebGL context of every canvas that was on it, also of one its style took out again', () => {
        const stage = document.createElement('div');
        const first = canvasWith('webgl2');
        stage.appendChild(first.canvas);
        const giveBack = followCanvases(stage);
        // A style mounts its canvas later, deep inside, and takes it out when it is disposed.
        const later = canvasWith('webgl');
        const box = document.createElement('div');
        stage.appendChild(box);
        box.appendChild(later.canvas);
        later.canvas.remove();
        expect(first.lose).not.toHaveBeenCalled();
        giveBack();
        expect(first.lose).toHaveBeenCalledTimes(1);
        expect(later.lose).toHaveBeenCalledTimes(1);
    });

    it('leaves a 2D canvas alone, makes no WebGL context on a canvas that had none, and passes one already lost', () => {
        const stage = document.createElement('div');
        const drawn = canvasWith('2d');
        const untouched = canvasWith(null);
        const gone = canvasWith('webgl2', true);
        stage.append(drawn.canvas, untouched.canvas, gone.canvas);
        followCanvases(stage)();
        expect(drawn.asked).toEqual(['2d']);
        expect(untouched.asked).toEqual(['2d']);
        expect(gone.lose).not.toHaveBeenCalled();
    });
});

describe('a style that throws on a picture\'s stage', () => {
    it('takes down only what is inside the boundary, and says so once', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const Broken: React.FC = () => {
            throw new Error('the style threw');
        };
        const onThrow = vi.fn();
        const host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        await act(async () => {
            root.render(React.createElement('div', null,
                React.createElement(PictureStageBoundary, { onThrow, children: React.createElement(Broken) }),
                React.createElement('span', null, 'the picker'),
            ));
        });
        expect(onThrow).toHaveBeenCalledTimes(1);
        expect(host.textContent).toBe('the picker');
        await act(async () => root.unmount());
        host.remove();
        vi.restoreAllMocks();
    });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    rampGain,
    rampGainDb,
    scheduleBandBlend,
    scheduleCrossfade,
    scheduleEchoThrow,
    softLimit,
} from '@/services/automix/crossfadeGraph';
import { dbToGain, BLEND_HEADROOM_DB } from '@/services/automix/signalAnalysis';
import {
    asGain,
    createFakeContext,
    createFakeFilter,
    createFakeGainNode,
    finalTarget,
    lastCurve,
} from './fakeAudioGraph';

// test/unit/automix/crossfadeGraph.test.ts

describe('scheduleCrossfade', () => {
    afterEach(() => vi.restoreAllMocks());

    it('puts both ramps on the audio clock over the same window', () => {
        const context = createFakeContext(12.5);
        const outgoing = createFakeGainNode();
        const incoming = createFakeGainNode();

        expect(scheduleCrossfade(context, asGain(outgoing), asGain(incoming), 4)).toBe(true);

        expect(lastCurve(outgoing)).toMatchObject({ time: 12.5, duration: 4 });
        expect(lastCurve(incoming)).toMatchObject({ time: 12.5, duration: 4 });
    });

    it('hands loudness over at constant power rather than dipping in the middle', () => {
        // Two uncorrelated songs summed on a linear pair lose about 3dB halfway through, and the
        // blend audibly sags. That has to hold wherever the handover is put, not only at 50%.
        //
        // Constant power UNDER the headroom, which is the deliberate exception: both curves carry
        // the same anti-clipping dip, so the ratio between them - which is what "constant power"
        // is a statement about - is untouched by it.
        const context = createFakeContext();
        const outgoing = createFakeGainNode();
        const incoming = createFakeGainNode();

        scheduleCrossfade(context, asGain(outgoing), asGain(incoming), 4, 0.3);

        const out = lastCurve(outgoing)!.curve;
        const into = lastCurve(incoming)!.curve;
        for (let index = 0; index < out.length; index += 1) {
            const headroom = dbToGain(-BLEND_HEADROOM_DB * Math.sin((index / (out.length - 1)) * Math.PI));
            expect(out[index] ** 2 + into[index] ** 2).toBeCloseTo(headroom ** 2, 5);
        }
    });

    it('keeps a decibel and a half in hand where the two masters are stacked', () => {
        // Equal power is a statement about power, not about peaks: two modern masters summed in
        // the middle of a blend can and do go past full scale. The dip has to be gone by both
        // ends, or it becomes a swell on the incoming track the moment it is alone.
        const context = createFakeContext();
        const outgoing = createFakeGainNode();
        const incoming = createFakeGainNode();

        scheduleCrossfade(context, asGain(outgoing), asGain(incoming), 4, 0.5);

        const out = lastCurve(outgoing)!.curve;
        const into = lastCurve(incoming)!.curve;
        let quietest = Infinity;
        for (let index = 0; index < out.length; index += 1) {
            quietest = Math.min(quietest, out[index] ** 2 + into[index] ** 2);
        }
        expect(quietest).toBeCloseTo(dbToGain(-BLEND_HEADROOM_DB) ** 2, 3);
        expect(out[0]).toBeCloseTo(1, 6);
        expect(into.at(-1)).toBeCloseTo(1, 6);
    });

    it('starts and ends on full handover, moving one way the whole time', () => {
        const context = createFakeContext();
        const outgoing = createFakeGainNode();
        const incoming = createFakeGainNode();

        scheduleCrossfade(context, asGain(outgoing), asGain(incoming), 4, 0.35);

        const out = lastCurve(outgoing)!.curve;
        const into = lastCurve(incoming)!.curve;
        expect(out[0]).toBeCloseTo(1, 6);
        expect(out.at(-1)).toBeCloseTo(0, 6);
        expect(into[0]).toBeCloseTo(0, 6);
        expect(into.at(-1)).toBeCloseTo(1, 6);
        for (let index = 1; index < out.length; index += 1) {
            expect(out[index]).toBeLessThan(out[index - 1]);
            expect(into[index]).toBeGreaterThan(into[index - 1]);
        }
    });

    it('reaches the halfway point where the crossover says, not in the middle', () => {
        const context = createFakeContext();
        const outgoing = createFakeGainNode();
        const incoming = createFakeGainNode();

        scheduleCrossfade(context, asGain(outgoing), asGain(incoming), 4, 0.3);

        const out = lastCurve(outgoing)!.curve;
        const crossing = out.findIndex(value => value <= Math.SQRT1_2);
        expect(crossing / (out.length - 1)).toBeCloseTo(0.3, 1);
    });

    it('leaves both decks in a defined state when the engine rejects the curves', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => { });
        const context = createFakeContext();
        const outgoing = createFakeGainNode();
        const incoming = createFakeGainNode();
        vi.spyOn(outgoing.gain, 'setValueCurveAtTime').mockImplementation(() => {
            throw new DOMException('overlaps a running curve', 'NotSupportedError');
        });

        expect(scheduleCrossfade(context, asGain(outgoing), asGain(incoming), 4)).toBe(false);

        // A blend is optional. An incoming deck stuck at zero gain is silent playback.
        expect(finalTarget(incoming)).toBe(1);
        expect(finalTarget(outgoing)).toBe(0);
    });
});

describe('scheduleCrossfade, held', () => {
    it('keeps the incoming deck silent until the handover moment', () => {
        // The incoming deck starts when the media element manages to start, not when we ask. So
        // placing a handover anywhere other than "now" means letting it run muted until then -
        // which is what makes a cut a cut and a splice a splice.
        const context = createFakeContext(10);
        const outgoing = createFakeGainNode();
        const incoming = createFakeGainNode();

        scheduleCrossfade(context, asGain(outgoing), asGain(incoming), 0.04, 0.5, 1.2);

        expect(incoming.events).toContainEqual({ type: 'set', time: 10, value: 0 });
        expect(outgoing.events).toContainEqual({ type: 'set', time: 10, value: 1 });
        expect(lastCurve(incoming)).toMatchObject({ time: 11.2, duration: 0.04 });
        expect(lastCurve(outgoing)).toMatchObject({ time: 11.2, duration: 0.04 });
    });
});

describe('scheduleBandBlend', () => {
    const stack = () => {
        const low = createFakeFilter('lowshelf');
        const mid = createFakeFilter('peaking');
        const high = createFakeFilter('highshelf');
        return {
            nodes: { low: low.node, mid: mid.node, high: high.node },
            params: [low.param, mid.param, high.param] as const,
        };
    };

    it('measures the reset from where the curve really starts, not from a start already gone', () => {
        // The engine slides a curve whose start is in the past forward to `currentTime` and keeps
        // its full duration, so it ends LATER than `startAt + seconds`. Scheduling the reset at that
        // arithmetic end puts it inside the running curve, and the engine refuses the event rather
        // than nudging it - taking the whole three-band shaping down with it, live, as
        // "band shaping rejected by the audio engine, blending flat".
        //
        // Two render quanta of lateness was enough to do it in the wild, and a late blend is not a
        // rare accident: it is a blend that was already short of time.
        const context = createFakeContext(20);
        const outgoing = stack();
        const incoming = stack();

        expect(scheduleBandBlend(context, outgoing.nodes, incoming.nodes, 19.5, 2, {
            crossover: 0.5, swapBass: true, sweepOut: true, tiltDb: [0, 0],
        })).toBe(true);

        for (const params of [outgoing.params, incoming.params]) {
            for (const param of params) {
                const curve = lastCurve(param)!;
                expect(curve.time).toBeGreaterThanOrEqual(context.currentTime);
                const after = param.events.filter(
                    event => event.type === 'set' || event.type === 'ramp',
                );
                expect(after.length).toBeGreaterThan(0);
                for (const event of after) {
                    expect(event.time).toBeGreaterThan(curve.time + curve.duration);
                }
            }
        }
    });

    const run = (request: Partial<Parameters<typeof scheduleBandBlend>[5]> = {}) => {
        const context = createFakeContext(0);
        const outgoing = stack();
        const incoming = stack();
        scheduleBandBlend(context, outgoing.nodes, incoming.nodes, 0, 4, {
            crossover: 0.5,
            swapBass: true,
            sweepOut: true,
            tiltDb: [0, 0],
            ...request,
        });
        return { outgoing, incoming };
    };

    it('brings the incoming track in without its bass and hands the low end over', () => {
        // The one thing two overlapping tracks cannot share. Everything below ~250Hz doubles in
        // level, beats against itself and cancels; the mids overlap perfectly happily.
        const { outgoing, incoming } = run();

        const arriving = lastCurve(incoming.params[0])!.curve;
        const leaving = lastCurve(outgoing.params[0])!.curve;
        expect(arriving[0]).toBeLessThan(-12);
        expect(arriving.at(-1)).toBeCloseTo(0, 5);
        expect(leaving[0]).toBeCloseTo(0, 5);
        expect(leaving.at(-1)!).toBeLessThan(-12);
    });

    it('takes the top off the outgoing track only after the two have changed places', () => {
        // A departing track that is filtered as well as faded reads as being pulled away rather
        // than turned down - but not before the handover, or it is simply missing its cymbals.
        const { outgoing } = run({ crossover: 0.5 });

        const high = lastCurve(outgoing.params[2])!.curve;
        expect(high[0]).toBeCloseTo(0, 5);
        expect(high[Math.floor(high.length / 2)]).toBeCloseTo(0, 2);
        expect(high.at(-1)!).toBeLessThan(-5);
    });

    it('leaves every band flat when the styles that want none are used', () => {
        const { outgoing, incoming } = run({ swapBass: false, sweepOut: false });

        for (const param of [...outgoing.params, ...incoming.params]) {
            const curve = lastCurve(param)!.curve;
            expect(Math.max(...Array.from(curve, Math.abs))).toBeCloseTo(0, 6);
        }
    });

    it('lands the incoming track back on its own tone by the handover', () => {
        // The tone match is a way in, not an effect: it has to be gone by the time the arriving
        // track is the one being listened to.
        const { incoming } = run({ tiltDb: [-2.5, 2] });

        const mid = lastCurve(incoming.params[1])!.curve;
        expect(mid[0]).toBeCloseTo(-2.5, 5);
        expect(mid[Math.round((mid.length - 1) * 0.5)]).toBeCloseTo(0, 5);
        expect(mid.at(-1)).toBeCloseTo(0, 5);
    });

    it('puts every band back to flat after the curve, not at wherever it ended', () => {
        // setValueCurveAtTime leaves a parameter at its last value for ever, and "for ever" here
        // is the next track. A deck left 24dB down in the low end plays it with no bass.
        const { outgoing, incoming } = run();

        for (const param of [...outgoing.params, ...incoming.params]) {
            expect(finalTarget(param)).toBe(0);
        }
    });
});

describe('scheduleEchoThrow', () => {
    const node = () => {
        const send = createFakeGainNode();
        const delayTime = createFakeGainNode();
        return {
            send,
            delayTime,
            handle: {
                send: asGain(send),
                delay: { delayTime: delayTime.gain } as unknown as DelayNode,
                feedback: asGain(createFakeGainNode()),
            },
        };
    };

    it('opens into the delay just before the track goes, and shuts as it goes', () => {
        // What is already in the line keeps repeating - that is the effect. Leaving the send open
        // would instead feed it the silence of a deck that has been paused.
        const context = createFakeContext(0);
        const { send, handle } = node();

        scheduleEchoThrow(context, handle, 2, 0.5);

        expect(send.events).toContainEqual({ type: 'ramp', time: 2, value: expect.any(Number) });
        expect(finalTarget(send)).toBe(0);
        const opens = send.events.find(event => event.type === 'set' && event.value === 0);
        expect(opens).toMatchObject({ time: 1.85 });
    });

    it('repeats on the grid rather than across it', () => {
        const context = createFakeContext(0);
        const { delayTime, handle } = node();

        scheduleEchoThrow(context, handle, 2, 0.5);

        // An eighth note at the outgoing track's own tempo.
        expect(finalTarget(delayTime)).toBeCloseTo(0.25, 6);
    });

    it('never schedules into the past', () => {
        const context = createFakeContext(5);
        const { send, handle } = node();

        scheduleEchoThrow(context, handle, 5.02, null);

        for (const event of send.events) expect(event.time).toBeGreaterThanOrEqual(5);
    });
});

describe('rampGain', () => {
    it('sets the value outright when given no time', () => {
        const context = createFakeContext(3);
        const node = createFakeGainNode();

        rampGain(context, asGain(node), 0.25);

        expect(node.events).toEqual([
            { type: 'cancel', time: 3 },
            { type: 'set', time: 3, value: 0.25 },
        ]);
    });

    it('holds the current value before ramping, so the move starts where the gain actually is', () => {
        const context = createFakeContext(3);
        const node = createFakeGainNode();
        node.gain.value = 0.4;

        rampGain(context, asGain(node), 1, 0.05);

        expect(node.events).toEqual([
            { type: 'cancel', time: 3 },
            { type: 'set', time: 3, value: 0.4 },
            { type: 'ramp', time: 3.05, value: 1 },
        ]);
    });

    it('converts dB to the linear gain the engine wants', () => {
        const context = createFakeContext();
        const node = createFakeGainNode();

        rampGainDb(context, asGain(node), -6, 0.4);

        expect(finalTarget(node)).toBeCloseTo(0.501, 3);
    });
});

describe('softLimit', () => {
    // What this replaced: a pass that measured the pair's summed peak and pulled the WHOLE blend
    // down far enough to cover it. On the pair that made it necessary - two 0 dBFS masters, summing
    // to +3.4 dBFS - that was about four decibels off every sample of the window to keep 1445 of
    // them legal, and four decibels through the middle of a transition is audible as ducking.

    it('leaves anything that already fits inside full scale exactly alone', () => {
        // The great majority of every window, and the reason the curve is a straight line here
        // rather than a gentle slope: the shaper interpolates linearly between points, so a
        // straight segment comes back out straight and nothing below the knee is touched at all.
        for (const x of [0, 0.1, -0.25, 0.5, -0.75, 0.9, 0.95, -0.95]) {
            expect(softLimit(x)).toBe(x);
        }
    });

    it('holds a sum that would have clipped under full scale', () => {
        // +3.4 dBFS is the measured case. The curve is asymptotic to 1 rather than stopping short
        // of it: a sample AT full scale is what an ordinary 0 dBFS master already sends through
        // this player every day, and the thing being prevented is the sample past it.
        for (const x of [1, 1.2, 1.5, 2, 4, 40, -1.5, -4]) {
            expect(Math.abs(softLimit(x))).toBeLessThanOrEqual(1);
        }
        expect(Math.abs(softLimit(1.5))).toBeGreaterThan(0.98);
    });

    it('joins the straight line without a corner', () => {
        // A step or a kink at the knee is a click, which is the failure this shape exists to avoid:
        // the whole point of shaping instead of ducking is that it stays inaudible.
        const below = softLimit(0.95 - 1e-4);
        const above = softLimit(0.95 + 1e-4);
        expect(above - below).toBeGreaterThan(0);
        expect(above - below).toBeLessThan(3e-4);
    });

    it('is monotonic and odd, so it changes level and never shape', () => {
        // Monotonic or a loud passage comes back out with its waveform folded; odd or the shaping
        // is asymmetric, which is a DC offset rather than a limiter.
        let previous = -Infinity;
        for (let x = -4; x <= 4; x += 0.01) {
            const y = softLimit(x);
            expect(y).toBeGreaterThanOrEqual(previous);
            expect(softLimit(-x)).toBeCloseTo(-y, 12);
            previous = y;
        }
    });
});

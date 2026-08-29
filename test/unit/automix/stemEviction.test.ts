import { describe, expect, it } from 'vitest';
import { MAX_WINDOWS, peakOf, pickStemVictim, toPcm } from '../../../src/services/automix/stems';

// Keys are `${playbackSongKey}:${role}`, oldest first - the order a Map hands them back.
const wantedSet = (...keys: string[]) => new Set(keys);

describe('pickStemVictim', () => {
    it('drops the oldest window nobody is waiting on', () => {
        const victim = pickStemVictim(
            ['intro:tail', 'chou:head', 'chou:tail'],
            wantedSet('intro:tail', 'chou:head'),
        );

        expect(victim).toBe('chou:tail');
    });

    it('reproduces the case it was written for', () => {
        // Playing Intro, next up 丑. A window for an abandoned transition (烂泥's head, requested
        // before the listener skipped) finishes late and lands in a full cache. Under plain LRU it
        // evicted Intro's tail - the one window the very next transition was certain to need.
        const cache = ['intro:tail', 'chou:head', 'chou:tail', 'lanni:head'];
        const victim = pickStemVictim(cache, wantedSet('intro:tail', 'chou:head'));

        expect(victim).not.toBe('intro:tail');
        const survivors = cache.filter(key => key !== victim);
        expect(survivors).toContain('intro:tail');
        expect(survivors).toContain('chou:head');
    });

    it('falls back to the oldest when every window is wanted', () => {
        const victim = pickStemVictim(
            ['a:tail', 'b:head'],
            wantedSet('a:tail', 'b:head'),
        );

        expect(victim).toBe('a:tail');
    });

    it('degrades to plain LRU when nothing has been named', () => {
        expect(pickStemVictim(['a:tail', 'b:head'], wantedSet())).toBe('a:tail');
    });

    it('has nothing to drop from an empty cache', () => {
        expect(pickStemVictim([], wantedSet('a:tail'))).toBeUndefined();
    });
});

describe('what survives a song change', () => {
    // `remember`, in the small: newest last, then the budget enforced through `pickStemVictim`. The
    // policy is what changed, so the policy is what is walked here rather than the Map holding it.
    const store = (cache: readonly string[], key: string, wanted: ReadonlySet<string>) => {
        const next = cache.filter(existing => existing !== key).concat(key);
        while (next.length > MAX_WINDOWS) {
            const victim = pickStemVictim(next, wanted, key);
            if (victim === undefined) break;
            next.splice(next.indexOf(victim), 1);
            if (victim === key) break;
        }
        return next;
    };

    /** Plays A -> B -> ... straight through, naming the pair that is COMING at each change. */
    const playThrough = (...tracks: string[]) => tracks.slice(0, -1).reduce((cache, track, index) => {
        const wanted = wantedSet(`${track}:tail`, `${tracks[index + 1]}:head`);
        return store(store(cache, `${track}:tail`, wanted), `${tracks[index + 1]}:head`, wanted);
    }, [] as readonly string[]);

    it('still holds the transition it just played, so pressing Previous is free', () => {
        // The bug this replaced: the pair a blend had just used was thrown away the moment it
        // finished, on the reasoning that nothing could ask for it again. Going back one track asks
        // for exactly it, and each window is ten seconds of htdemucs to rebuild.
        const cache = playThrough('a', 'b', 'c');

        expect(cache).toContain('a:tail');
        expect(cache).toContain('b:head');
    });

    it('does not let a window for an excursion take the slot of one next door', () => {
        // Read off a real session, twice. Playing A with B next, cache full and holding the step
        // back as designed. The listener skips to D and straight back to A; D's tail - requested in
        // those few seconds, already past the check that could have cancelled it - lands ten seconds
        // later. Under oldest-first it evicted B's tail, which the next transition separated again.
        const cache = ['b:tail', 'c:head', 'a:tail', 'b:head'];

        expect(store(cache, 'd:tail', wantedSet('a:tail', 'b:head'))).toEqual(cache);
    });

    it('keeps one nobody has named while a slot is going spare', () => {
        // The half that makes this different from refusing to store such a window at all, which was
        // tried and was worse. Seeking mid-blend cancels it and leaves the listener on the SAME
        // track, so `wanted` swings back to the pair already playing while the pair being prepared -
        // the one arming again in a minute - is briefly unwanted. Thrown away, every cancel cost ten
        // seconds of htdemucs that the next arm paid for again.
        expect(store(['a:tail', 'b:head'], 'b:tail', wantedSet('a:tail', 'b:head')))
            .toEqual(['a:tail', 'b:head', 'b:tail']);
    });

    it('lets go after one step back, which is where the line is', () => {
        // Not unbounded, or the fix above would just be a leak: the pair before last goes.
        const cache = playThrough('a', 'b', 'c', 'd');

        expect(cache).toEqual(['b:tail', 'c:head', 'c:tail', 'd:head']);
    });
});

describe('stem storage', () => {
    const roundTrip = (samples: number[]) => {
        const pcm = toPcm(Float32Array.from(samples), Float32Array.from(samples));
        return [...pcm].map(value => value / 32767);
    };

    it('keeps the two channels apart, left then right', () => {
        const pcm = toPcm(Float32Array.from([1, 1]), Float32Array.from([-1, -1]));

        expect([...pcm]).toEqual([32767, 32767, -32767, -32767]);
    });

    it('holds a sample to within the -96 dBFS floor it claims', () => {
        const samples = [0, 0.5, -0.5, 0.123456, -0.987654];
        roundTrip(samples).slice(0, samples.length).forEach((value, index) => {
            expect(Math.abs(value - samples[index])).toBeLessThan(1 / 32767);
        });
    });

    it('clamps past full scale rather than wrapping it', () => {
        // `other` is a difference of four signals, so this happens. Wrapping turns the loudest
        // sample of a blend into its own negation, which is a click.
        const pcm = toPcm(Float32Array.from([1.4, -1.4]), Float32Array.from([0, 0]));

        expect([...pcm].slice(0, 2)).toEqual([32767, -32768]);
    });

    it('reads a peak of 1 off anything that fits, and the real one off anything that does not', () => {
        expect(peakOf(Float32Array.from([0.5, -0.2]), Float32Array.from([0.1, 0.1]))).toBe(1);
        expect(peakOf(Float32Array.from([0.5, -1.75]), Float32Array.from([0.1, 0.1]))).toBe(1.75);
        expect(peakOf(Float32Array.from([0.1]), Float32Array.from([2.5]))).toBe(2.5);
    });

    it('stores a stem that overshoots without flattening its loudest samples', () => {
        // The whole point of the divisor. Stored against a fixed 1.0 ceiling these three become one
        // number, and a blend built from them has its peaks shaved off where it is loudest.
        const left = Float32Array.from([1.4, 1.9, 2.1]);
        const right = Float32Array.from([0, 0, 0]);
        const gain = peakOf(left, right);
        const pcm = toPcm(left, right, gain);
        const back = [...pcm].slice(0, 3).map(value => (value / 32767) * gain);

        expect(new Set(pcm.slice(0, 3))).toHaveProperty('size', 3);
        back.forEach((value, index) => {
            expect(Math.abs(value - left[index])).toBeLessThan(gain / 32767);
        });
    });
});

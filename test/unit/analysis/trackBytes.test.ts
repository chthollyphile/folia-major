import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeTrackAtRate, giveTrackBytes, loadTrackBytes, peekTrackBytes, putTrackBytes, resetTrackBytesForTests, trackBytesFit } from '@/services/analysis/trackBytes';

// test/unit/analysis/trackBytes.test.ts
// One read of a track's bytes for every analyser, a copy for each so a decode (which detaches its
// input) cannot take them from another, a size cap, and one decode per key and rate while it runs.

const bytesOf = (size: number, fill = 1) => new Uint8Array(size).fill(fill).buffer;
/** What decodeAudioData does to its input. */
const detach = (buffer: ArrayBuffer) => structuredClone(buffer, { transfer: [buffer] });

describe('track bytes', () => {
    beforeEach(() => resetTrackBytesForTests());

    it('reads once for two callers at the same time, then hands the kept bytes over', async () => {
        const read = vi.fn(async () => bytesOf(8));
        const [a, b] = await Promise.all([loadTrackBytes('song-1', read), loadTrackBytes('song-1', read)]);
        expect(read).toHaveBeenCalledTimes(1);
        expect([a.source, b.source]).toEqual(['read', 'joined']);
        const later = await loadTrackBytes('song-1', read);
        expect(later.source).toBe('kept');
        expect(read).toHaveBeenCalledTimes(1);
    });

    it('gives every caller its own copy: one decoded (detached) leaves the others whole', async () => {
        const first = await loadTrackBytes('song-1', async () => bytesOf(8));
        detach(first.bytes!);
        expect(first.bytes!.byteLength).toBe(0);
        const second = await loadTrackBytes('song-1', async () => null);
        expect(second.bytes!.byteLength).toBe(8);
        detach(second.bytes!);
        expect(peekTrackBytes('song-1')!.byteLength).toBe(8);
    });

    it('reads by its own rules when the read it joined found nothing', async () => {
        let answer!: (bytes: ArrayBuffer | null) => void;
        const first = vi.fn(() => new Promise<ArrayBuffer | null>((resolve) => { answer = resolve; }));
        const own = vi.fn(async () => bytesOf(6));
        const a = loadTrackBytes('song-1', first);
        const b = loadTrackBytes('song-1', own);
        answer(null);
        expect((await a).bytes).toBeNull();
        expect(await b).toMatchObject({ source: 'read' });
        expect((await b).bytes!.byteLength).toBe(6);
        expect(peekTrackBytes('song-1')!.byteLength).toBe(6);
    });

    it('does not remember a read that found nothing', async () => {
        expect((await loadTrackBytes('song-1', async () => null)).bytes).toBeNull();
        const read = vi.fn(async () => bytesOf(4));
        expect((await loadTrackBytes('song-1', read)).bytes!.byteLength).toBe(4);
        expect(read).toHaveBeenCalledTimes(1);
    });

    it('keeps what a caller read its own way, as a copy of it', async () => {
        const own = bytesOf(4);
        putTrackBytes('song-1', own);
        detach(own);
        const read = vi.fn(async () => null);
        expect((await loadTrackBytes('song-1', read)).bytes!.byteLength).toBe(4);
        expect(read).not.toHaveBeenCalled();
    });

    it('drops the least recently used tracks past 64 MB', async () => {
        const mb = 1024 * 1024;
        putTrackBytes('a', bytesOf(30 * mb));
        putTrackBytes('b', bytesOf(30 * mb));
        // Used: now newer than b.
        expect(peekTrackBytes('a')).not.toBeNull();
        putTrackBytes('c', bytesOf(30 * mb));
        expect(peekTrackBytes('b')).toBeNull();
        expect(peekTrackBytes('a')).not.toBeNull();
        expect(peekTrackBytes('c')).not.toBeNull();
    });
});

describe('track decode', () => {
    beforeEach(() => resetTrackBytesForTests());

    const fakeBuffer = (rate: number) => ({ sampleRate: rate }) as unknown as AudioBuffer;

    it('decodes once per key and rate while it runs, and again once it has answered', async () => {
        let finish!: () => void;
        const decode = vi.fn((_bytes: ArrayBuffer, rate: number) => new Promise<AudioBuffer>((resolve) => {
            finish = () => resolve(fakeBuffer(rate));
        }));
        const a = decodeTrackAtRate('song-1', 44100, bytesOf(4), decode, 'drum hits', 'own');
        const b = decodeTrackAtRate('song-1', 44100, bytesOf(4), decode, 'stems tail', 'kept');
        expect(decode).toHaveBeenCalledTimes(1);
        finish();
        expect(await a).toBe(await b);
        // Nothing kept once answered.
        const c = decodeTrackAtRate('song-1', 44100, bytesOf(4), decode, 'stems head', 'kept');
        expect(decode).toHaveBeenCalledTimes(2);
        finish();
        await c;
    });

    it('keeps the two rates apart', async () => {
        const decode = vi.fn(async (_bytes: ArrayBuffer, rate: number) => fakeBuffer(rate));
        const [low, high] = await Promise.all([
            decodeTrackAtRate('song-1', 22050, bytesOf(4), decode, 'beats', 'read'),
            decodeTrackAtRate('song-1', 44100, bytesOf(4), decode, 'drum hits', 'own'),
        ]);
        expect(decode).toHaveBeenCalledTimes(2);
        expect([low?.sampleRate, high?.sampleRate]).toEqual([22050, 44100]);
    });
});

describe('the shared bytes, from the PR #750 review', () => {
    beforeEach(() => resetTrackBytesForTests());
    afterEach(() => vi.useRealTimers());

    it('lets the bytes go after 15 minutes untouched, and a read pushes that back', () => {
        vi.useFakeTimers();
        putTrackBytes('a', new ArrayBuffer(8));
        vi.advanceTimersByTime(14 * 60_000);
        expect(peekTrackBytes('a')).not.toBeNull();
        vi.advanceTimersByTime(14 * 60_000);
        expect(peekTrackBytes('a')).not.toBeNull();
        vi.advanceTimersByTime(15 * 60_000 + 1);
        expect(peekTrackBytes('a')).toBeNull();
    });

    it('keeps a handed-over copy as it is, and says what does not fit', () => {
        const own = new ArrayBuffer(8);
        giveTrackBytes('a', own);
        expect(peekTrackBytes('a')?.byteLength).toBe(8);
        expect(trackBytesFit(0)).toBe(false);
        expect(trackBytesFit(64 * 1024 * 1024)).toBe(true);
        expect(trackBytesFit(64 * 1024 * 1024 + 1)).toBe(false);
    });
});

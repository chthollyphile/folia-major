import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// test/unit/electron/videoExportMp4.test.ts
const require = createRequire(import.meta.url);
const { finalizeVideoExport } = require('../../../electron/videoExportMp4.cjs') as {
    finalizeVideoExport(buffer: Buffer): Buffer;
};
const uint = (value: number) => { const data = Buffer.alloc(4); data.writeUInt32BE(value); return data; };
const wide = (value: bigint) => { const data = Buffer.alloc(8); data.writeBigUInt64BE(value); return data; };
const box = (type: string, ...parts: Buffer[]) => {
    const payload = Buffer.concat(parts);
    return Buffer.concat([uint(payload.length + 8), Buffer.from(type), payload]);
};
const full = (version = 0, flags = 0) => uint(version * 0x1000000 + flags);
const header = (type: 'mvhd' | 'mdhd' | 'tkhd', value: number, version = 1) => {
    const bytes = Buffer.alloc(type === 'tkhd' ? (version ? 36 : 24) : (version ? 32 : 20));
    bytes[0] = version;
    bytes.writeUInt32BE(value, version ? 20 : 12);
    // Reproduce MediaRecorder's unfinished zero movie duration and first-fragment track durations.
    if (type !== 'mvhd') {
        const offset = type === 'tkhd' ? (version ? 28 : 20) : (version ? 24 : 16);
        if (version) bytes.writeBigUInt64BE(1684n, offset); else bytes.writeUInt32BE(1684, offset);
    }
    return box(type, bytes);
};
const track = (id: number, scale: number, version = 1, edit = false) => box('trak', header('tkhd', id, version),
    box('mdia', header('mdhd', scale, version)), ...(edit ? [box('edts', box('elst', full(), uint(0)))] : []));
const trex = (id: number, duration: number) => box('trex', full(), uint(id), uint(1), uint(duration), uint(0), uint(0));
const movie = (tracks: Buffer[], version = 1, defaults: Buffer[] = []) => box('moov', header('mvhd', 1000, version), ...tracks,
    box('mvex', ...defaults, box('mehd', full(version), version ? wide(0n) : uint(0))));
function fragment(id: number, time: bigint | null, durations: number[], options: {
    defaultDuration?: number; noDurations?: boolean; compositions?: number[]; version?: number; fields?: boolean;
} = {}) {
    const version = options.version ?? 1;
    const flags = (options.noDurations ? 0 : 0x100) | (options.compositions ? 0x800 : 0) | (options.fields ? 0x605 : 0);
    const samples = durations.map((duration, index) => {
        const parts = options.noDurations ? [] : [uint(duration)];
        if (options.fields) parts.push(uint(7), uint(0x2000000));
        if (options.compositions) {
            const offset = Buffer.alloc(4);
            if (version) offset.writeInt32BE(options.compositions[index]);
            else offset.writeUInt32BE(options.compositions[index]);
            parts.push(offset);
        }
        return Buffer.concat(parts);
    });
    const fields = options.fields ? [uint(42), uint(0)] : [];
    return box('moof', box('traf',
        box('tfhd', full(0, options.defaultDuration ? 8 : 0), uint(id), ...(options.defaultDuration ? [uint(options.defaultDuration)] : [])),
        ...(time === null ? [] : [box('tfdt', full(1), wide(time))]),
        box('trun', full(version, flags), uint(durations.length), ...fields, ...samples)));
}
const recording = (moov: Buffer, ...fragments: Buffer[]) => Buffer.concat([box('ftyp', Buffer.from('isom')), moov,
    ...fragments.flatMap(item => [item, box('mdat', Buffer.from('encoded-frame-payload'))])]);
function durations(buffer: Buffer, type: 'mvhd' | 'mdhd' | 'tkhd' | 'mehd') {
    const result: bigint[] = [];
    let from = 0;
    while (true) {
        const found = buffer.indexOf(type, from);
        if (found < 0) return result;
        const base = found + 4, version = buffer[base];
        const offset = base + (type === 'mehd' ? 4 : type === 'tkhd' ? (version ? 28 : 20) : (version ? 24 : 16));
        result.push(version ? buffer.readBigUInt64BE(offset) : BigInt(buffer.readUInt32BE(offset)));
        from = base;
    }
}

describe('finalizing recorded fragmented MP4', () => {
    it.each([0, 1])('writes consistent movie/track/media durations in version %s without changing media or timestamps', version => {
        const data = recording(movie([track(1, 30000, version), track(2, 44100, version)], version),
            fragment(1, 0n, [30000, 30000]), fragment(2, 0n, [44100, 44100]),
            fragment(1, 60000n, [29501]), fragment(2, 88200n, [43000]));
        const before = Buffer.from(data), boundary = data.indexOf('moof') - 4;
        expect(finalizeVideoExport(data)).toBe(data);
        expect(data.subarray(boundary)).toEqual(before.subarray(boundary));
        expect(durations(data, 'mvhd')).toEqual([2984n]);
        expect(durations(data, 'tkhd')).toEqual([2984n, 2976n]);
        expect(durations(data, 'mdhd')).toEqual([89501n, 131200n]);
        expect(durations(data, 'mehd')).toEqual([2984n]);
        const once = Buffer.from(data);
        expect(finalizeVideoExport(data)).toEqual(once);
    });
    it('honors tfhd over trex defaults and continues a fragment without tfdt from the prior decode end', () => {
        const data = recording(movie([track(1, 1000)], 1, [trex(1, 25)]),
            fragment(1, 0n, [0, 0], { noDurations: true }),
            fragment(1, null, [0, 0], { noDurations: true, defaultDuration: 30 }));
        finalizeVideoExport(data);
        expect(durations(data, 'mdhd')).toEqual([110n]);
    });
    it.each([0, 1])('includes positive composition offsets and optional sample fields (trun version %s)', version => {
        const data = recording(movie([track(1, 1000)]), fragment(1, 0n, [10, 10], { version, compositions: [0, 50], fields: true }));
        finalizeVideoExport(data);
        expect(durations(data, 'mvhd')).toEqual([70n]);
    });
    it('retains the decode duration when signed negative composition offsets end earlier', () => {
        const data = recording(movie([track(1, 1000)]), fragment(1, 0n, [10, 10], { compositions: [-10, -5] }));
        finalizeVideoExport(data);
        expect(durations(data, 'mdhd')).toEqual([20n]);
    });
    it('keeps uint64 decode times exact above JavaScript safe integer range', () => {
        const base = 9007199254740993n;
        const data = recording(movie([track(1, 1000)]), fragment(1, base, [10]));
        finalizeVideoExport(data);
        expect(durations(data, 'mvhd')).toEqual([base + 10n]);
    });
    it.each(['overflow', 'edit-list', 'truncated', 'missing-duration', 'unknown-track', 'unknown-version'])('rejects %s without partially modifying the buffer', kind => {
        const data = recording(movie([track(1, 1000, kind === 'overflow' ? 0 : 1, kind === 'edit-list')], kind === 'overflow' ? 0 : 1),
            fragment(kind === 'unknown-track' ? 2 : 1, kind === 'overflow' ? 0xffffffffn : 0n, [10], { noDurations: kind === 'missing-duration' }));
        if (kind === 'truncated') data.writeUInt32BE(0xffffffff, data.indexOf('trun') + 8);
        if (kind === 'unknown-version') data[data.indexOf('mdhd') + 4] = 2;
        const before = Buffer.from(data);
        expect(() => finalizeVideoExport(data)).toThrow('Invalid recorded MP4');
        expect(data).toEqual(before);
    });
    it('clears an empty track duration when recording stops before its first sample', () => {
        const data = recording(movie([track(1, 1000), track(2, 48000)]), fragment(1, 0n, [10]));
        finalizeVideoExport(data);
        expect(durations(data, 'tkhd')).toEqual([10n, 0n]);
        expect(durations(data, 'mdhd')).toEqual([10n, 0n]);
    });
    it('does not alter WebM or an already non-fragmented MP4', () => {
        for (const data of [Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), recording(movie([track(1, 1000)]))]) {
            const before = Buffer.from(data);
            expect(finalizeVideoExport(data)).toBe(data);
            expect(data).toEqual(before);
        }
    });
    it('rejects truncated and oversized boxes before examining duration fields', () => {
        const extended = Buffer.concat([uint(1), Buffer.from('moov'), wide(0xffffffffffffffffn)]);
        expect(() => finalizeVideoExport(Buffer.concat([box('ftyp'), extended]))).toThrow('oversized moov');
        expect(() => finalizeVideoExport(Buffer.concat([box('ftyp'), Buffer.from([0])]))).toThrow('truncated box header');
    });
});

import { parseBlob } from 'music-metadata';
import { describe, expect, it } from 'vitest';
import { withMetadataParserTypeHint } from '../../../src/utils/metadataParserTypeHint';

// test/unit/utils/metadataParserTypeHint.test.ts
// Parses a synthetic DSDIFF file the way the metadata worker receives it: a File with no MIME type.

const encoder = new TextEncoder();
const DSD64_RATE = 2822400;

const concat = (...parts: Uint8Array[]) => {
    const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let offset = 0;
    for (const part of parts) {
        bytes.set(part, offset);
        offset += part.length;
    }
    return bytes;
};

const u16be = (value: number) => new Uint8Array([value >> 8, value & 0xff]);
const u32be = (value: number) => {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value);
    return bytes;
};

/** A DSDIFF chunk: FourCC, 64-bit big-endian size, body, and the pad byte an odd body needs. */
const chunk = (id: string, ...body: Uint8Array[]) => {
    const data = concat(...body);
    const header = new Uint8Array(12);
    header.set(encoder.encode(id));
    new DataView(header.buffer).setBigUint64(4, BigInt(data.length));
    return concat(header, data, new Uint8Array(data.length % 2));
};

const id3Title = (title: string) => {
    const text = concat(new Uint8Array([0]), encoder.encode(title));
    const frame = concat(encoder.encode('TIT2'), u32be(text.length), new Uint8Array(2), text);
    return concat(encoder.encode('ID3'), new Uint8Array([3, 0, 0, 0, 0, 0, frame.length]), frame);
};

/** One second of stereo DSD64 silence pattern with an ID3 title, as most DSDIFF writers lay it out. */
const dsdiffFile = (name: string, type = '') => {
    const form = concat(
        encoder.encode('DSD '),
        chunk('FVER', u32be(0x01050000)),
        chunk('PROP', encoder.encode('SND '),
            chunk('FS  ', u32be(DSD64_RATE)),
            chunk('CHNL', u16be(2), encoder.encode('SLFTSRGT')),
            // The pstring's pad byte belongs to the string, so the chunk size counts it.
            chunk('CMPR', encoder.encode('DSD '), new Uint8Array([14]), encoder.encode('not compressed'), new Uint8Array(1))),
        chunk('DSD ', new Uint8Array(DSD64_RATE / 8 * 2).fill(0x69)),
        chunk('ID3 ', id3Title('DSDIFF Track')),
    );
    return new File([chunk('FRM8', form)], name, { type });
};

describe('withMetadataParserTypeHint', () => {
    it('lets music-metadata read a .dff that arrives without a MIME type', async () => {
        const file = dsdiffFile('Track.DFF');
        await expect(parseBlob(file)).rejects.toThrow();

        const parsed = await parseBlob(withMetadataParserTypeHint(file, file.name));
        expect(parsed.format.container).toBe('DSDIFF/DSD');
        expect(parsed.format.sampleRate).toBe(DSD64_RATE);
        expect(parsed.format.numberOfChannels).toBe(2);
        expect(parsed.format.duration).toBe(1);
        expect(parsed.common.title).toBe('DSDIFF Track');
    });

    it('leaves other files and already typed Blobs alone', () => {
        const typed = dsdiffFile('Track.dff', 'audio/dsd');
        expect(withMetadataParserTypeHint(typed, typed.name)).toBe(typed);
        const other = new File([new Uint8Array(4)], 'Track.dsf');
        expect(withMetadataParserTypeHint(other, other.name)).toBe(other);
    });
});

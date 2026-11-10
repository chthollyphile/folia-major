// src/utils/metadataParserTypeHint.ts
// Names the music-metadata parser for local files it can neither identify by MIME type nor sniff.

const DSDIFF_FILE = /\.dff$/i;
/** The DSDIFF parser's own MIME type in music-metadata. */
const DSDIFF_MIME_TYPE = 'audio/dsd';

/**
 * music-metadata picks a parser from the Blob's MIME type, else by sniffing the bytes; the file
 * name never reaches it. The browser has no MIME type for .dff and file-type cannot sniff DSDIFF,
 * so without this a .dff imports with no tags and no duration. Slicing only relabels the Blob.
 */
export function withMetadataParserTypeHint(input: Blob, fileName: string): Blob {
    if (input.type || !DSDIFF_FILE.test(fileName)) return input;
    return input.slice(0, input.size, DSDIFF_MIME_TYPE);
}

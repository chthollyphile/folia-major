'use strict';

// electron/alphaExport/ffmpegCapabilities.cjs
// Reads what an ffmpeg build can do from its own `-version`, `-encoders` and `-demuxers` output, and
// the table of transparent video formats the export can write with it. Pure text parsing: no process
// is started here, so the rules are unit-tested on captured output (test/unit/electron/alphaExport*).

/**
 * The transparent formats, in the order they are offered. `encoder` must be listed by `-encoders`;
 * `args` follow `-i pipe:0` of a raw BGRA/RGBA stream. The table is the single place that knows
 * which pixel format keeps the alpha plane for each encoder, and which container (`muxer`) carries it:
 * VP9's alpha lives in WebM's BlockAdditional, so the muxer never follows the file name.
 */
const ALPHA_FORMATS = Object.freeze([
    Object.freeze({
        id: 'prores',
        encoder: 'prores_ks',
        extension: 'mov',
        muxer: 'mov',
        // ProRes 4444 carries alpha only in its 4444 profiles, at 10-bit 4:4:4.
        args: Object.freeze(['-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le']),
    }),
    Object.freeze({
        id: 'vp9',
        encoder: 'libvpx-vp9',
        extension: 'webm',
        muxer: 'webm',
        args: Object.freeze(['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '30', '-row-mt', '1']),
    }),
    Object.freeze({
        id: 'qtrle',
        encoder: 'qtrle',
        extension: 'mov',
        muxer: 'mov',
        // QuickTime Animation: lossless RLE; argb is the one of its pixel formats with alpha.
        args: Object.freeze(['-c:v', 'qtrle', '-pix_fmt', 'argb']),
    }),
]);

const ALPHA_FORMAT_IDS = Object.freeze(ALPHA_FORMATS.map((format) => format.id));

const findAlphaFormat = (id) => ALPHA_FORMATS.find((format) => format.id === id) ?? null;

/** `ffmpeg version 7.1-full_build-www.gyan.dev Copyright ...` -> `7.1-full_build-www.gyan.dev`; null when unrecognised. */
const parseFfmpegVersion = (stdout) => {
    const firstLine = String(stdout ?? '').split(/\r?\n/).find((line) => line.trim().length > 0) ?? '';
    const match = /ffmpeg version (\S+)/i.exec(firstLine);
    return match ? match[1] : null;
};

/**
 * Names from a `-encoders` / `-decoders` / `-demuxers` style listing. Rows sit under a `------`
 * rule as `<flags> <name> <description>`; the legend above the rule is skipped. `-demuxers` rows
 * have a short flag column (` D  rawvideo`), `-encoders` a six-letter one (` V....D libvpx-vp9`):
 * the name is the token after the flags either way. Newer builds add a lowercase `d` column for
 * devices (` D d dshow`), skipped too. Comma-joined names (`matroska,webm`) are split.
 */
const parseCodecList = (stdout) => {
    const names = new Set();
    const lines = String(stdout ?? '').split(/\r?\n/);
    const ruleIndex = lines.findIndex((line) => /^\s*-{2,}\s*$/.test(line));
    const body = ruleIndex >= 0 ? lines.slice(ruleIndex + 1) : lines;
    for (const line of body) {
        const match = /^\s*[A-Z.]{1,6}(?:\s+d)?\s+(\S+)/.exec(line);
        if (!match) {
            continue;
        }
        for (const name of match[1].split(',')) {
            if (name) {
                names.add(name);
            }
        }
    }
    return names;
};

/**
 * What a build can export: the transparent formats whose encoder it has, and whether it reads a raw
 * pixel pipe at all (the audio-only runtime this app ships for transcoding does not, and would die on
 * the first frame). A build is usable for the transparent export only with `rawvideo` and at least one format.
 */
const describeExportCapabilities = ({ encoders, demuxers }) => {
    const encoderSet = encoders instanceof Set ? encoders : new Set(encoders ?? []);
    const demuxerSet = demuxers instanceof Set ? demuxers : new Set(demuxers ?? []);
    const rawvideo = demuxerSet.has('rawvideo');
    const formats = ALPHA_FORMATS.filter((format) => encoderSet.has(format.encoder)).map((format) => format.id);
    let problem = null;
    if (!rawvideo) {
        problem = 'no-rawvideo';
    } else if (formats.length === 0) {
        problem = 'no-alpha-encoder';
    }
    return { rawvideo, formats, usable: problem === null, problem };
};

module.exports = {
    ALPHA_FORMATS,
    ALPHA_FORMAT_IDS,
    findAlphaFormat,
    parseFfmpegVersion,
    parseCodecList,
    describeExportCapabilities,
};

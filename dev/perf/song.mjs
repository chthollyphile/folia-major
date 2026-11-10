import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

// dev/perf/song.mjs
// Makes the test song the measuring page plays: audio, lyrics, a cover and a table of band levels.
//
// Everything is computed from the numbers in this file with a seeded generator, so two runs write
// the same bytes and nobody has to keep an 8 MB WAV in git. The lyrics are invented for this rig;
// they are no real song's words.
//
//   node dev/perf/song.mjs            writes dev/perf/.build/public/{song.wav,lyrics.json,cover.png,cover-b.png,signal.bin}
//
// What is in the song and why:
//   - a kick on every beat and a bass line, so `bass` / `audioPower` pulse;
//   - a pad and a lead in the 1-3 kHz range, so `mid` / `vocal` move;
//   - hi-hats whose pattern and loudness change by section, so `treble` changes over the song;
//   - Chinese and English lines with a time for every word, translations on some lines, one pause
//     over 3 s (30.2 s to 34.6 s), one long line (42.6 s) and one fast passage (46.2 s to 55.6 s).
// The measured window is 40 s to 48 s (see WINDOW below): a Chinese line with a translation, the
// long mixed line, and the first two fast lines.

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PUBLIC_DIR = path.join(HERE, '.build', 'public');

export const SAMPLE_RATE = 44100;
export const DURATION_SECONDS = 96;
/** The part of the song every measurement plays: start and length in seconds. */
export const WINDOW = { startSeconds: 40, lengthSeconds: 8 };
/** Band levels are stored at this many steps per second (see writeSignal). */
export const SIGNAL_RATE = 60;
export const SIGNAL_SPECTRUM_BINS = 64;

/** A small seeded generator (mulberry32): the same numbers on every run. */
const seeded = (seed) => {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

// ---------------------------------------------------------------------------------------------
// Lyrics
// ---------------------------------------------------------------------------------------------

/**
 * The lines of the main song: start, length, text, and optionally a translation and a chorus mark.
 * A Chinese character is one timed word; a Latin word (with the space after it) is one timed word.
 */
const SONG_A = [
    [6.0, 2.6, '清晨的站台没有人说话', 'Nobody speaks on the platform at dawn'],
    [8.9, 2.5, 'Paper boats in a puddle of light'],
    [11.7, 2.8, '我把地图折成一只风筝', 'I fold the map into a kite'],
    [14.8, 2.4, 'Count the windows, lose the count'],
    [17.5, 2.9, '路灯一盏一盏学会了沉默', 'One by one the streetlamps learn to keep quiet'],
    [20.7, 2.6, 'Somewhere a kettle starts to sing'],
    [23.6, 3.0, '风从很远的地方带来盐的味道', 'The wind brings the taste of salt from far away'],
    [26.9, 3.1, 'Hold the note until it turns to rain'],
    // 30.2 to 34.6: nothing is sung (the pause over 3 seconds).
    [34.6, 2.5, '于是我们开始奔跑', 'And so we start to run', true],
    [37.3, 2.5, 'Lanterns up, lanterns up, over the hill', undefined, true],
    [40.0, 2.4, '把昨夜的雨声折进口袋', 'Fold last night\'s rain into a pocket', true],
    [42.6, 3.4, '沿着海岸线一路向北 until the lighthouse blinks twice and the tide lets go of our names', 'North along the coastline, until the lighthouse blinks twice and the tide lets go of our names', true],
    [46.2, 0.85, '快一点 再快一点'],
    [47.1, 0.85, 'Run run don\'t look back'],
    [48.0, 0.9, '跳过水洼 跳过影子'],
    [48.95, 0.9, 'Left right left right spin'],
    [49.9, 0.9, '数到三 就放手'],
    [50.85, 0.9, 'One two three and gone'],
    [51.8, 0.9, '心跳追着鼓点跑'],
    [52.75, 0.9, 'Faster than the morning train'],
    [53.7, 0.9, '别停 别停 别回头'],
    [54.65, 0.95, 'Catch it catch it let it go'],
    [56.2, 2.8, '后来城市慢慢亮了起来', 'Later the city slowly lit up'],
    [59.2, 2.6, 'Every roof a different kind of blue'],
    [62.0, 3.0, '我们坐在屋顶分一个橘子', 'We sit on the roof and share one orange'],
    [65.2, 2.6, 'You said the moon was only on loan'],
    [68.0, 3.0, '那就借到天亮再还回去', 'Then keep it till daybreak and give it back'],
    [71.2, 2.8, 'Quiet now, the tide is turning home'],
    [74.4, 2.5, '于是我们继续奔跑', 'And so we keep on running', true],
    [77.1, 2.5, 'Lanterns up, lanterns up, over the sea', undefined, true],
    [79.8, 2.6, '把今晚的风声写成信', 'Write tonight\'s wind into a letter', true],
    [82.6, 3.2, '寄给还没有名字的明天 and sign it with a paper boat', 'Send it to a tomorrow that has no name yet, and sign it with a paper boat', true],
    [86.2, 3.0, 'Hold the note until it turns to light'],
];

/** The second song (the one a "song change" switches to): it starts singing at 1.4 s. */
const SONG_B = [
    [1.4, 2.4, '另一首歌从这里开始', 'Another song begins here'],
    [4.0, 2.4, 'Chalk lines on a quiet street'],
    [6.6, 2.6, '我们数着台阶往上走', 'We count the steps on the way up'],
    [9.4, 2.4, 'Small bells in a paper sky'],
    [12.0, 2.8, '把钥匙留在信箱里面', 'Leave the key inside the letterbox'],
    [15.0, 2.6, 'Second window from the left'],
    [17.8, 2.8, '等风停了再说晚安', 'Say good night once the wind has stopped'],
    [20.8, 2.6, 'Slow now, slower, almost still'],
    [23.6, 2.8, '灯一关就听见海', 'Lights off, and you can hear the sea'],
];

const isLatin = (char) => /[A-Za-z0-9'’,.!?-]/.test(char);

/** Cuts a line into timed words: Chinese characters one by one, Latin words whole with the space after them. */
const tokenize = (text) => {
    const tokens = [];
    let latin = '';
    const flush = () => {
        if (latin) {
            tokens.push(latin);
            latin = '';
        }
    };
    for (const char of Array.from(text)) {
        if (char === ' ') {
            if (latin) {
                latin += ' ';
                flush();
            } else if (tokens.length > 0) {
                tokens[tokens.length - 1] += ' ';
            }
        } else if (isLatin(char)) {
            latin += char;
        } else {
            flush();
            tokens.push(char);
        }
    }
    flush();
    return tokens;
};

const round3 = (value) => Math.round(value * 1000) / 1000;

const buildLines = (spec, idPrefix) => spec.map(([start, length, text, translation, isChorus], index) => {
    const tokens = tokenize(text);
    const weights = tokens.map(token => (isLatin(token[0]) ? 1.2 + 0.15 * token.trim().length : 1));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let cursor = start;
    const words = tokens.map((token, tokenIndex) => {
        const span = (length * weights[tokenIndex]) / total;
        const word = { text: token, startTime: round3(cursor), endTime: round3(cursor + span) };
        cursor += span;
        return word;
    });
    return {
        id: `${idPrefix}-${index}`,
        words,
        startTime: round3(start),
        endTime: round3(start + length),
        fullText: tokens.join(''),
        ...(translation ? { translation } : {}),
        ...(isChorus ? { isChorus: true } : {}),
    };
});

// ---------------------------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------------------------

const BEAT_SECONDS = 0.5;
const BASS_NOTES = [55, 55, 65.41, 73.42, 49, 49, 61.74, 82.41];
const CHORDS = [
    [220, 261.63, 329.63],
    [196, 246.94, 293.66],
    [174.61, 220, 261.63],
    [196, 246.94, 329.63],
];
const LEAD_NOTES = [1046.5, 1318.5, 1568, 1975.5, 1760, 1568, 1318.5, 2349.3];

/** How loud each part is in each stretch of the song: [until second, kick, bass, pad, lead, hats, hat steps per beat]. */
const SECTIONS = [
    [6, 0.0, 0.25, 0.5, 0.0, 0.15, 1],
    [30.2, 0.8, 0.7, 0.45, 0.35, 0.3, 2],
    [34.6, 0.0, 0.15, 0.6, 0.0, 0.05, 1],
    [46.2, 1.0, 0.85, 0.5, 0.55, 0.5, 2],
    [55.6, 1.0, 0.8, 0.3, 0.6, 0.75, 4],
    [74.4, 0.8, 0.7, 0.5, 0.4, 0.35, 2],
    [89.4, 1.0, 0.85, 0.5, 0.55, 0.55, 4],
    [DURATION_SECONDS, 0.0, 0.3, 0.5, 0.15, 0.1, 1],
];

const sectionAt = (time) => SECTIONS.find(section => time < section[0]) ?? SECTIONS[SECTIONS.length - 1];

/** The whole song as samples between -1 and 1. */
const synthesize = () => {
    const sampleCount = SAMPLE_RATE * DURATION_SECONDS;
    const samples = new Float32Array(sampleCount);
    const random = seeded(20261011);
    let previousNoise = 0;

    for (let index = 0; index < sampleCount; index += 1) {
        const time = index / SAMPLE_RATE;
        const [, kickLevel, bassLevel, padLevel, leadLevel, hatLevel, hatSteps] = sectionAt(time);
        const beat = time / BEAT_SECONDS;
        const beatPhase = (beat % 1) * BEAT_SECONDS;
        const bar = Math.floor(beat / 4);

        // Kick: a sine that falls from 120 Hz to 45 Hz in a quarter of a second.
        const kickFrequencyPhase = 2 * Math.PI * (45 * beatPhase + (75 * 0.06) * (1 - Math.exp(-beatPhase / 0.06)));
        const kick = Math.sin(kickFrequencyPhase) * Math.exp(-beatPhase / 0.11) * kickLevel;

        // Bass: an eighth-note line, one note per bar, with two harmonics.
        const eighthPhase = (beat * 2) % 1;
        const bassFrequency = BASS_NOTES[bar % BASS_NOTES.length];
        const bassEnvelope = Math.exp(-eighthPhase * 2.2);
        const bass = (Math.sin(2 * Math.PI * bassFrequency * time)
            + 0.45 * Math.sin(2 * Math.PI * bassFrequency * 2 * time)
            + 0.2 * Math.sin(2 * Math.PI * bassFrequency * 3 * time)) * 0.5 * bassEnvelope * bassLevel;

        // Pad: a slow three-note chord that changes every two bars.
        const chord = CHORDS[Math.floor(bar / 2) % CHORDS.length];
        const swell = 0.7 + 0.3 * Math.sin(2 * Math.PI * time / 7);
        const pad = chord.reduce((sum, frequency) => sum + Math.sin(2 * Math.PI * frequency * time), 0) / 3 * 0.35 * swell * padLevel;

        // Lead: one note per half beat in the range a voice sits in.
        const halfBeat = Math.floor(beat * 2);
        const leadFrequency = LEAD_NOTES[(halfBeat * 3 + bar) % LEAD_NOTES.length];
        const leadPhase = (beat * 2) % 1;
        const lead = Math.sin(2 * Math.PI * leadFrequency * time) * Math.exp(-leadPhase * 3) * 0.3 * leadLevel;

        // Hats: short bursts of high-passed noise; more of them per beat in the fast stretches.
        const hatPhase = (beat * hatSteps) % 1;
        const noise = random() * 2 - 1;
        const highPassed = noise - previousNoise;
        previousNoise = noise;
        const hat = highPassed * Math.exp(-hatPhase * (BEAT_SECONDS / hatSteps) / 0.02) * 0.35 * hatLevel;

        samples[index] = Math.tanh((kick + bass + pad + lead + hat) * 1.1);
    }
    return samples;
};

const encodeWav = (samples) => {
    const dataBytes = samples.length * 2;
    const buffer = Buffer.alloc(44 + dataBytes);
    buffer.write('RIFF', 0, 'ascii');
    buffer.writeUInt32LE(36 + dataBytes, 4);
    buffer.write('WAVE', 8, 'ascii');
    buffer.write('fmt ', 12, 'ascii');
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(SAMPLE_RATE, 24);
    buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36, 'ascii');
    buffer.writeUInt32LE(dataBytes, 40);
    for (let index = 0; index < samples.length; index += 1) {
        buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[index])) * 32767), 44 + index * 2);
    }
    return buffer;
};

// ---------------------------------------------------------------------------------------------
// Band levels (for the repeatable pictures, where no audio plays)
// ---------------------------------------------------------------------------------------------

const FFT_SIZE = 2048;

/** In-place radix-2 FFT. */
const fft = (real, imaginary) => {
    const size = real.length;
    for (let index = 1, reversed = 0; index < size; index += 1) {
        let bit = size >> 1;
        for (; reversed & bit; bit >>= 1) reversed ^= bit;
        reversed ^= bit;
        if (index < reversed) {
            [real[index], real[reversed]] = [real[reversed], real[index]];
            [imaginary[index], imaginary[reversed]] = [imaginary[reversed], imaginary[index]];
        }
    }
    for (let length = 2; length <= size; length <<= 1) {
        const angle = (-2 * Math.PI) / length;
        const stepReal = Math.cos(angle);
        const stepImaginary = Math.sin(angle);
        for (let start = 0; start < size; start += length) {
            let currentReal = 1;
            let currentImaginary = 0;
            for (let offset = 0; offset < length / 2; offset += 1) {
                const evenIndex = start + offset;
                const oddIndex = evenIndex + length / 2;
                const oddReal = real[oddIndex] * currentReal - imaginary[oddIndex] * currentImaginary;
                const oddImaginary = real[oddIndex] * currentImaginary + imaginary[oddIndex] * currentReal;
                real[oddIndex] = real[evenIndex] - oddReal;
                imaginary[oddIndex] = imaginary[evenIndex] - oddImaginary;
                real[evenIndex] += oddReal;
                imaginary[evenIndex] += oddImaginary;
                const nextReal = currentReal * stepReal - currentImaginary * stepImaginary;
                currentImaginary = currentReal * stepImaginary + currentImaginary * stepReal;
                currentReal = nextReal;
            }
        }
    }
};

/**
 * The band levels the app would read from its analyser, worked out here from the samples: the same
 * FFT size, smoothing, decibel range and band edges as usePlaybackAudioBridge and
 * usePlaybackVisualizerBridge. One record per 1/60 s: audioPower, bass, lowMid, mid, vocal, treble
 * (0..255 each, one byte), then the spectrum cut down to 64 bytes.
 */
const buildSignal = (samples) => {
    const frameCount = DURATION_SECONDS * SIGNAL_RATE;
    const recordBytes = 6 + SIGNAL_SPECTRUM_BINS;
    const out = Buffer.alloc(frameCount * recordBytes);
    const window = new Float64Array(FFT_SIZE);
    for (let index = 0; index < FFT_SIZE; index += 1) {
        const phase = (2 * Math.PI * index) / FFT_SIZE;
        window[index] = 0.42 - 0.5 * Math.cos(phase) + 0.08 * Math.cos(2 * phase);
    }
    const smoothed = new Float64Array(FFT_SIZE / 2);
    const bytes = new Uint8Array(FFT_SIZE / 2);
    const real = new Float64Array(FFT_SIZE);
    const imaginary = new Float64Array(FFT_SIZE);
    const energy = (minHz, maxHz) => {
        const start = Math.floor(minHz / 21.5);
        const end = Math.floor(maxHz / 21.5);
        let sum = 0;
        for (let bin = start; bin <= end; bin += 1) sum += bytes[bin];
        return sum / (end - start + 1);
    };
    const shape = (value, boost) => Math.round(Math.pow(value / 255, boost) * 255);

    for (let frame = 0; frame < frameCount; frame += 1) {
        const end = Math.round(((frame + 1) / SIGNAL_RATE) * SAMPLE_RATE);
        for (let index = 0; index < FFT_SIZE; index += 1) {
            const sampleIndex = end - FFT_SIZE + index;
            real[index] = sampleIndex >= 0 && sampleIndex < samples.length ? samples[sampleIndex] * window[index] : 0;
            imaginary[index] = 0;
        }
        fft(real, imaginary);
        for (let bin = 0; bin < FFT_SIZE / 2; bin += 1) {
            const magnitude = Math.hypot(real[bin], imaginary[bin]) / FFT_SIZE;
            smoothed[bin] = 0.6 * smoothed[bin] + 0.4 * magnitude;
            const decibels = 20 * Math.log10(Math.max(smoothed[bin], 1e-12));
            bytes[bin] = Math.max(0, Math.min(255, Math.floor((255 / 70) * (decibels + 100))));
        }
        const bass = energy(20, 150);
        const lowMid = energy(150, 400);
        const mid = energy(400, 1200);
        const vocal = energy(1000, 3500);
        const treble = energy(3500, 12000);
        const base = frame * recordBytes;
        out[base] = shape((bass + lowMid) / 2, 3);
        out[base + 1] = shape(bass, 1.8);
        out[base + 2] = shape(lowMid, 2);
        out[base + 3] = shape(mid, 2);
        out[base + 4] = shape(vocal, 1.5);
        out[base + 5] = shape(treble, 2);
        const binsPerStep = (FFT_SIZE / 2) / SIGNAL_SPECTRUM_BINS;
        for (let step = 0; step < SIGNAL_SPECTRUM_BINS; step += 1) {
            let sum = 0;
            for (let bin = step * binsPerStep; bin < (step + 1) * binsPerStep; bin += 1) sum += bytes[bin];
            out[base + 6 + step] = Math.round(sum / binsPerStep);
        }
    }
    return out;
};

// ---------------------------------------------------------------------------------------------
// Cover
// ---------------------------------------------------------------------------------------------

const pngChunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
};

/** A 512 px picture with a colour gradient, discs and stripes: something for cover-derived backgrounds to work on. */
export const buildCover = (seed, [fromColor, toColor, discColor]) => {
    const size = 512;
    const random = seeded(seed);
    const discs = Array.from({ length: 7 }, () => ({
        x: random() * size,
        y: random() * size,
        radius: 30 + random() * 110,
        mix: 0.35 + random() * 0.5,
    }));
    const raw = Buffer.alloc(size * (size * 3 + 1));
    for (let y = 0; y < size; y += 1) {
        const rowStart = y * (size * 3 + 1);
        raw[rowStart] = 0;
        for (let x = 0; x < size; x += 1) {
            const blend = (x * 0.6 + y * 0.4) / size;
            const pixel = [0, 1, 2].map(channel => fromColor[channel] + (toColor[channel] - fromColor[channel]) * blend);
            for (const disc of discs) {
                if (Math.hypot(x - disc.x, y - disc.y) < disc.radius) {
                    for (let channel = 0; channel < 3; channel += 1) {
                        pixel[channel] += (discColor[channel] - pixel[channel]) * disc.mix;
                    }
                }
            }
            const stripe = (x + y) % 64 < 6 ? 0.82 : 1;
            for (let channel = 0; channel < 3; channel += 1) {
                raw[rowStart + 1 + x * 3 + channel] = Math.max(0, Math.min(255, Math.round(pixel[channel] * stripe)));
            }
        }
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(size, 0);
    header.writeUInt32BE(size, 4);
    header[8] = 8;
    header[9] = 2;
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk('IHDR', header),
        pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        pngChunk('IEND', Buffer.alloc(0)),
    ]);
};

// ---------------------------------------------------------------------------------------------

/** Writes the song's files; with `onlyIfMissing` it leaves a complete set alone. */
export const writeSong = ({ onlyIfMissing = false } = {}) => {
    const files = ['song.wav', 'lyrics.json', 'cover.png', 'cover-b.png', 'signal.bin'].map(name => path.join(PUBLIC_DIR, name));
    if (onlyIfMissing && files.every(file => fs.existsSync(file))) {
        return false;
    }
    fs.mkdirSync(PUBLIC_DIR, { recursive: true });
    const samples = synthesize();
    fs.writeFileSync(files[0], encodeWav(samples));
    fs.writeFileSync(files[1], JSON.stringify({
        durationSeconds: DURATION_SECONDS,
        window: WINDOW,
        signal: { rate: SIGNAL_RATE, spectrumBins: SIGNAL_SPECTRUM_BINS },
        songs: {
            a: { id: 'perf-song-a', title: 'Paper Lanterns (perf rig)', artist: 'Folia Perf Rig', album: 'Measured Nights', cover: 'cover.png', lines: buildLines(SONG_A, 'a') },
            b: { id: 'perf-song-b', title: 'Second Window (perf rig)', artist: 'Folia Perf Rig', album: 'Measured Nights', cover: 'cover-b.png', lines: buildLines(SONG_B, 'b') },
        },
    }));
    fs.writeFileSync(files[2], buildCover(7, [[24, 60, 140], [230, 120, 60], [250, 220, 120]]));
    fs.writeFileSync(files[3], buildCover(11, [[30, 110, 90], [150, 60, 150], [240, 240, 250]]));
    fs.writeFileSync(files[4], buildSignal(samples));
    return true;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    writeSong();
    console.log(`[perf] song written to ${PUBLIC_DIR}`);
}

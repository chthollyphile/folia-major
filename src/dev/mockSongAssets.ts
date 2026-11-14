// src/dev/mockSongAssets.ts
// The dev mock song's files, made in the page: a synthesized 120 BPM loop as WAV, word-timed lyrics as
// enhanced LRC (with translations, CJK lines and an instrumental break), and a folder cover. Nothing is
// fetched, so it works offline, in a fresh profile, and with no platform signed in. The audio, tag and
// cover builders take options so the mock library (mockLibrary.ts) can make short, distinct tracks.

export const MOCK_SONG_ARTIST = 'Folia Dev';
export const MOCK_SONG_TITLE = 'Mock Song';
export const MOCK_SONG_ALBUM = 'Dev Fixtures';
export const MOCK_SONG_SECONDS = 72;

const SAMPLE_RATE = 22050;
const BEAT_SECONDS = 0.5;
const BAR_SECONDS = BEAT_SECONDS * 4;
const INTRO_END_SECONDS = 4;
const BREAK_START_SECONDS = 32;
const BREAK_END_SECONDS = 40;
const OUTRO_START_SECONDS = 62;

// C, Am, F, G: one chord a bar.
const CHORDS = [
    [261.63, 329.63, 392.0],
    [220.0, 261.63, 329.63],
    [174.61, 220.0, 261.63],
    [196.0, 246.94, 293.66],
];

export type MockLyricLine = {
    start: number;
    words: string[];
    translation?: string;
    /** Seconds the words spread over; the line ends half a second after. */
    span?: number;
};

// Start times sit on bar lines. English words carry their trailing space, as enhanced LRC writes them.
const LYRIC_LINES: MockLyricLine[] = [
    { start: 4, words: ['Light ', 'falls ', 'on ', 'the ', 'empty ', 'stage'], translation: '灯光落在空荡的舞台' },
    { start: 8, words: ['Every ', 'word ', 'arrives ', 'on ', 'time'], translation: '每个词都准时到来' },
    { start: 12, words: ['落', '叶', '数', '着', '每', '一', '拍'] },
    { start: 16, words: ['这一行', '用来', '测试', '中文', '排版'] },
    { start: 20, words: ['Hold ', 'this ', 'note ', 'longer'], translation: '把这个音再拖长一点', span: 3.5 },
    { start: 24, words: ['Then ', 'let ', 'it ', 'fade ', 'away'], translation: '然后让它慢慢淡去' },
    { start: 28, words: ['ひとつ', 'ふたつ', 'みっつ', 'よっつ'] },
    { start: 40, words: ['Second ', 'verse, ', 'same ', 'old ', 'clock'], translation: '第二段，还是那只钟' },
    { start: 44, words: ['Faster ', 'words ', 'pile ', 'up ', 'and ', 'run ', 'and ', 'stop'], span: 2 },
    { start: 48, words: ['夜', 'が', '明', 'け', 'る', 'ま', 'で'], translation: '直到天亮' },
    { start: 52, words: ['最后', '一句', '慢慢', '地', '落下'] },
    { start: 56, words: ['Folia ', 'mock ', 'song, ', 'the ', 'end'], translation: 'Folia 测试歌曲，完' },
];

const pad2 = (value: number) => `${value}`.padStart(2, '0');

const lineTag = (seconds: number) => {
    const centis = Math.round(seconds * 100);
    return `[${pad2(Math.floor(centis / 6000))}:${pad2(Math.floor(centis / 100) % 60)}.${pad2(centis % 100)}]`;
};

const wordTag = (seconds: number) => {
    const millis = Math.round(seconds * 1000);
    return `<${pad2(Math.floor(millis / 60000))}:${pad2(Math.floor(millis / 1000) % 60)}.${`${millis % 1000}`.padStart(3, '0')}>`;
};

/** The tags a mock track carries, in its WAV (RIFF INFO) and its LRC header. */
export type MockTrackTags = { title: string; artist: string; album: string; track?: number };

const MOCK_SONG_TAGS: MockTrackTags = { title: MOCK_SONG_TITLE, artist: MOCK_SONG_ARTIST, album: MOCK_SONG_ALBUM };

/** The lyrics as enhanced LRC: words spread evenly over each line's span, a translation as a second line of the same tag. */
export const buildMockLyrics = (tags: MockTrackTags = MOCK_SONG_TAGS, lines: readonly MockLyricLine[] = LYRIC_LINES): string => {
    const rows = [
        `[ti:${tags.title}]`,
        `[ar:${tags.artist}]`,
        `[al:${tags.album}]`,
    ];
    for (const line of lines) {
        const span = line.span ?? 3;
        const step = span / line.words.length;
        const words = line.words.map((word, index) => `${wordTag(line.start + index * step)}${word}`).join('');
        rows.push(`${lineTag(line.start)}${words}${wordTag(line.start + span + 0.5)}`);
        if (line.translation) {
            rows.push(`${lineTag(line.start)}${line.translation}`);
        }
    }
    return `${rows.join('\n')}\n`;
};

/** A RIFF INFO chunk so the file carries its own title, artist, album (and track number) tags. */
const buildInfoChunk = (tags: MockTrackTags): Uint8Array<ArrayBuffer> => {
    const encoder = new TextEncoder();
    const entries: Array<[string, string]> = [['INAM', tags.title], ['IART', tags.artist], ['IPRD', tags.album]];
    if (tags.track !== undefined) entries.push(['ITRK', String(tags.track)]);
    const parts = entries.map(([id, text]) => {
        const bytes = encoder.encode(`${text}\0`);
        const padded = new Uint8Array(8 + bytes.length + (bytes.length % 2));
        const view = new DataView(padded.buffer);
        padded.set(encoder.encode(id), 0);
        view.setUint32(4, bytes.length, true);
        padded.set(bytes, 8);
        return padded;
    });
    const bodyLength = 4 + parts.reduce((sum, part) => sum + part.length, 0);
    const chunk = new Uint8Array(8 + bodyLength);
    const view = new DataView(chunk.buffer);
    chunk.set(encoder.encode('LIST'), 0);
    view.setUint32(4, bodyLength, true);
    chunk.set(encoder.encode('INFO'), 8);
    let offset = 12;
    for (const part of parts) {
        chunk.set(part, offset);
        offset += part.length;
    }
    return chunk;
};

/** How a mock track sounds and how long it is; the defaults are the mock song. */
export type MockAudioOptions = {
    tags?: MockTrackTags;
    seconds?: number;
    /** Frequency ratio for every chord (1 = the mock song's key). */
    transpose?: number;
};

/**
 * An ID3v2.3 tag in an `id3 ` chunk, its text frames in UTF-16. RIFF INFO text has no encoding of its own
 * and is read as Latin-1, so a track whose tags are not plain ASCII (the CJK albums of the mock library)
 * carries this instead.
 */
const buildId3Chunk = (tags: MockTrackTags): Uint8Array<ArrayBuffer> => {
    const ascii = (text: string) => Uint8Array.from(text, char => char.charCodeAt(0));
    const frames: Array<[string, string]> = [['TIT2', tags.title], ['TPE1', tags.artist], ['TALB', tags.album]];
    if (tags.track !== undefined) frames.push(['TRCK', String(tags.track)]);
    const frameBytes = frames.map(([id, text]) => {
        // Encoding 1 (UTF-16 with a byte-order mark), then the text as UTF-16LE.
        const body = new Uint8Array(3 + text.length * 2);
        body.set([1, 0xff, 0xfe], 0);
        for (let index = 0; index < text.length; index += 1) {
            const code = text.charCodeAt(index);
            body[3 + index * 2] = code & 0xff;
            body[4 + index * 2] = code >> 8;
        }
        const frame = new Uint8Array(10 + body.length);
        frame.set(ascii(id), 0);
        new DataView(frame.buffer).setUint32(4, body.length);
        frame.set(body, 10);
        return frame;
    });
    const tagSize = frameBytes.reduce((sum, frame) => sum + frame.length, 0);
    const tag = new Uint8Array(10 + tagSize);
    tag.set(ascii('ID3'), 0);
    tag.set([3, 0, 0], 3);
    // The tag size is synchsafe: seven bits a byte.
    tag.set([(tagSize >> 21) & 0x7f, (tagSize >> 14) & 0x7f, (tagSize >> 7) & 0x7f, tagSize & 0x7f], 6);
    let offset = 10;
    for (const frame of frameBytes) {
        tag.set(frame, offset);
        offset += frame.length;
    }
    const chunk = new Uint8Array(8 + tag.length + (tag.length % 2));
    chunk.set(ascii('id3 '), 0);
    new DataView(chunk.buffer).setUint32(4, tag.length, true);
    chunk.set(tag, 8);
    return chunk;
};

const isPlainAscii = (tags: MockTrackTags) => /^[\x00-\x7f]*$/.test(`${tags.title}${tags.artist}${tags.album}`);

/**
 * The audio: kick on every beat, a noise hat on the off-beats, bass and a chord pad. The intro is pad
 * only and the break drops the drums, so beat-driven visualizers have something to follow and something
 * to lose. Mono 16-bit PCM at 22.05 kHz, about 3 MB for the 72-second mock song. A track shorter than the
 * break's start has no break, and fades out over its last 4 seconds.
 */
export const buildMockAudio = ({ tags = MOCK_SONG_TAGS, seconds = MOCK_SONG_SECONDS, transpose = 1 }: MockAudioOptions = {}): Blob => {
    const sampleCount = SAMPLE_RATE * seconds;
    const outroStart = seconds === MOCK_SONG_SECONDS ? OUTRO_START_SECONDS : Math.max(0, seconds - 4);
    const pcm = new Int16Array(sampleCount);
    let noiseSeed = 0x2f6b1d;
    for (let index = 0; index < sampleCount; index += 1) {
        const t = index / SAMPLE_RATE;
        const beatPos = t % BEAT_SECONDS;
        const barPos = t % BAR_SECONDS;
        const chord = CHORDS[Math.floor(t / BAR_SECONDS) % CHORDS.length].map(frequency => frequency * transpose);
        const hasDrums = t >= INTRO_END_SECONDS && (t < BREAK_START_SECONDS || t >= BREAK_END_SECONDS);

        let sample = 0;
        // Pad and bass swell in at each bar line.
        const padEnv = Math.min(1, barPos / 0.08) * (0.7 + 0.3 * Math.exp(-barPos * 1.5));
        for (const frequency of chord) {
            sample += Math.sin(2 * Math.PI * frequency * t) * 0.07 * padEnv;
        }
        sample += Math.sin(2 * Math.PI * (chord[0] / 2) * t) * 0.14 * padEnv;

        if (hasDrums) {
            // Kick: a 140 → 50 Hz sweep, the phase integrated so it does not click.
            const kickPhase = 2 * Math.PI * (50 * beatPos + 3 * (1 - Math.exp(-30 * beatPos)));
            sample += Math.sin(kickPhase) * Math.exp(-beatPos * 12) * 0.55;
            const offBeat = beatPos - BEAT_SECONDS / 2;
            if (offBeat >= 0) {
                noiseSeed = (noiseSeed * 1103515245 + 12345) & 0x7fffffff;
                sample += ((noiseSeed / 0x7fffffff) * 2 - 1) * Math.exp(-offBeat * 70) * 0.12;
            }
        }

        const fadeOut = t >= outroStart ? Math.max(0, (seconds - t) / (seconds - outroStart)) : 1;
        pcm[index] = Math.round(Math.tanh(sample * fadeOut) * 0x7fff);
    }

    const info = isPlainAscii(tags) ? buildInfoChunk(tags) : buildId3Chunk(tags);
    const dataBytes = sampleCount * 2;
    const header = new DataView(new ArrayBuffer(36));
    const ascii = (offset: number, text: string) => [...text].forEach((char, i) => header.setUint8(offset + i, char.charCodeAt(0)));
    ascii(0, 'RIFF');
    header.setUint32(4, 36 + info.length + 8 + dataBytes - 8, true);
    ascii(8, 'WAVE');
    ascii(12, 'fmt ');
    header.setUint32(16, 16, true);
    header.setUint16(20, 1, true);
    header.setUint16(22, 1, true);
    header.setUint32(24, SAMPLE_RATE, true);
    header.setUint32(28, SAMPLE_RATE * 2, true);
    header.setUint16(32, 2, true);
    header.setUint16(34, 16, true);
    const dataHeader = new DataView(new ArrayBuffer(8));
    'data'.split('').forEach((char, i) => dataHeader.setUint8(i, char.charCodeAt(0)));
    dataHeader.setUint32(4, dataBytes, true);
    return new Blob([header, info, dataHeader, pcm], { type: 'audio/wav' });
};

/** A cover's look: three gradient stops and the word across it; the defaults are the mock song's. */
export type MockCoverOptions = { colors?: readonly [string, string, string]; label?: string };

/** The folder cover: a saturated gradient, so cover-derived themes and backgrounds have colour to work with. */
export const buildMockCover = async ({ colors = ['#ff5f6d', '#845ec2', '#00c9a7'], label = 'MOCK' }: MockCoverOptions = {}): Promise<Blob> => {
    const size = 600;
    const canvas = new OffscreenCanvas(size, size);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2d canvas unavailable');
    const gradient = context.createLinearGradient(0, 0, size, size);
    gradient.addColorStop(0, colors[0]);
    gradient.addColorStop(0.5, colors[1]);
    gradient.addColorStop(1, colors[2]);
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
    context.fillStyle = 'rgba(255, 255, 255, 0.18)';
    context.beginPath();
    context.arc(size * 0.68, size * 0.36, size * 0.22, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#ffffff';
    context.font = 'bold 84px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(label, size / 2, size * 0.72);
    return await canvas.convertToBlob({ type: 'image/png' });
};

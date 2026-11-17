import { ensureLyricDataRenderHints } from '../../utils/lyrics/renderHints';
import { finalizeParsedLyricLines } from '../../utils/lyrics/parserCore';
import type { Line } from '../../types';

// src/components/perfCheck/perfCheckFixture.ts
// What the performance check plays: a short word-by-word lyric, looped, with made-up band levels for
// the picture, and a made-up stereo segment and spectrogram for the GPU analysis (its time does not
// depend on what the audio is). Nothing is read from the user's library, the network or the disk.
//
// The lyric is written for the check (no quoted text): looking up at stars that do not look back, in
// English, Chinese, Japanese, Korean and French, so the reference style lays out every script it meets.

/** The lyric's length, s; the check's clock loops over it. */
export const FIXTURE_SECONDS = 40;

/** [start s, words, translation?]: each line's words spread over three seconds. */
const LINES: [number, string[], string?][] = [
    [1, ['I ', 'look ', 'up, ', 'and ', 'the ', 'sky ', 'does ', 'not ', 'look ', 'back'], '我抬起头，天空并不回望'],
    [5, ['星星', '不知道', '我的', '名字']],
    [9, ['名前も', '知らない', '星を', '数える'], '数着叫不出名字的星'],
    [13, ['Still ', 'I ', 'leave ', 'a ', 'lamp ', 'on ', 'for ', 'the ', 'dark'], '我仍为黑夜留一盏灯'],
    [17, ['就让我', '多看', '它们', '一眼']],
    [21, ['별이 ', '대답하지 ', '않아도 ', '괜찮아'], '星星不回答也没关系'],
    [25, ['Je ', 'compte ', 'les ', 'étoiles ', "jusqu'au ", 'matin'], '我数着星星，直到清晨'],
    [29, ['天亮', '以前', '我先', '学会', '想念']],
    [33, ['and ', 'call ', 'the ', 'quiet ', 'sky ', 'enough'], '把安静的天空，当作足够'],
];

/** The lyric as Line[], word-timed, with what the app's parsers add to every file (the '......' lines in long gaps, the render hints). */
export const buildFixtureLines = (): Line[] => {
    const span = 3;
    const parsed: Line[] = LINES.map(([start, words, translation]) => {
        const step = span / words.length;
        return {
            startTime: start,
            endTime: start + span + 0.5,
            fullText: words.join(''),
            words: words.map((text, index) => ({ text, startTime: start + index * step, endTime: start + (index + 1) * step })),
            ...(translation ? { translation } : {}),
        };
    });
    const lines = finalizeParsedLyricLines(parsed);
    return ensureLyricDataRenderHints({ lines, isWordByWord: true })?.lines ?? lines;
};

/** One htdemucs segment's worth of stereo audio at 44.1 kHz: a kick, a hat and a chord. */
export const buildFixtureSegment = (samples: number): { left: Float32Array; right: Float32Array } => {
    const left = new Float32Array(samples);
    const right = new Float32Array(samples);
    let seed = 1;
    const noise = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
    for (let i = 0; i < samples; i += 1) {
        const t = i / 44100;
        const beat = t % 0.5;
        const kick = Math.sin(2 * Math.PI * (50 + 100 * Math.exp(-beat * 30)) * beat) * Math.exp(-beat * 8);
        const hat = noise() * Math.exp(-(t % 0.25) * 60) * 0.3;
        const chord = 0.2 * (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277 * t) + Math.sin(2 * Math.PI * 330 * t)) / 3;
        left[i] = 0.5 * kick + hat + chord;
        right[i] = 0.5 * kick + hat * 0.8 + chord;
    }
    return { left, right };
};

/** A spectrogram of `frames` x 128 log-mel bands for beat_this, with a pulse every half second. */
export const buildFixtureMel = (frames: number): Float32Array => {
    const mel = new Float32Array(frames * 128);
    for (let frame = 0; frame < frames; frame += 1) {
        const pulse = frame % 25 < 2 ? 2 : 0;
        for (let band = 0; band < 128; band += 1) mel[frame * 128 + band] = pulse + Math.sin(frame * 0.05 + band * 0.3);
    }
    return mel;
};

/** Band levels for the picture at song time `t`, 0-1: a kick every half second over a slow swell. */
export const fixtureBands = (t: number) => {
    const beat = Math.exp(-(t % 0.5) * 9);
    const swell = 0.5 + 0.5 * Math.sin(t * 0.7);
    return {
        power: 0.35 + 0.4 * beat * swell,
        bass: 0.4 + 0.55 * beat,
        lowMid: 0.35 + 0.3 * swell,
        mid: 0.3 + 0.3 * Math.sin(t * 2.1) ** 2,
        vocal: 0.3 + 0.4 * Math.sin(t * 1.3) ** 2,
        treble: 0.2 + 0.4 * Math.exp(-(t % 0.25) * 14),
    };
};

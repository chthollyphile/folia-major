'use strict';

// electron/dux/qrcLyrics.cjs
// Turns the word-synced lines Dux's lyric engine returns into the QRC and LRC text that Folia's
// Now Playing source already parses. Kept free of I/O so the timestamp mapping is easy to test.

const CONTROL_CHARS = /[\u0000-\u001f\u007f]+/g;
const MAX_TEXT_CHARS = 4096;

/** One lyric string as D-Bus/IPC clients can safely carry it: one line, no control characters. */
const cleanText = value => (typeof value === 'string'
    ? value.slice(0, MAX_TEXT_CHARS).replace(CONTROL_CHARS, ' ').trim()
    : '');

/** Plain lyrics keep their line breaks; only control characters other than newline go. */
const sanitizePlain = value => (typeof value === 'string'
    ? value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ').slice(0, 200000).trim()
    : '');

/** Word text keeps its spaces: QRC joins the words by concatenation, so trimming each one loses them. */
const cleanWordText = value => (typeof value === 'string'
    ? value.slice(0, MAX_TEXT_CHARS).replace(CONTROL_CHARS, ' ')
    : '');

const toMilliseconds = value => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric * 1000) : null;
};

const lrcTimestamp = milliseconds => {
    const total = Math.max(0, milliseconds);
    const minutes = Math.floor(total / 60000);
    const seconds = Math.floor((total % 60000) / 1000);
    const centiseconds = Math.floor((total % 1000) / 10);
    return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}]`;
};

/**
 * One Dux line → one QRC line: `[lineStart,lineDuration](wordStart,wordDuration)word…`.
 * Word times are absolute milliseconds in QRC, which is what Folia's parser reads.
 * A line without word timings becomes a single word so line-only lyrics stay in sync.
 */
const qrcLine = (line, nextLine) => {
    const lineStart = toMilliseconds(line?.t) ?? 0;
    const nextStart = toMilliseconds(nextLine?.t);
    const lineEnd = toMilliseconds(line?.e) ?? nextStart ?? lineStart + 1000;
    const duration = Math.max(1, lineEnd - lineStart);
    const words = Array.isArray(line?.w) && line.w.length > 0
        ? line.w
        : [{ t: lineStart / 1000, e: lineEnd / 1000, x: line?.x }];

    let body = '';
    let cursor = lineStart;
    for (let index = 0; index < words.length; index += 1) {
        const word = words[index];
        const text = cleanWordText(word?.x);
        if (!text.trim()) continue;
        const start = toMilliseconds(word?.t) ?? cursor;
        const nextWordStart = toMilliseconds(words[index + 1]?.t);
        const end = toMilliseconds(word?.e) ?? nextWordStart ?? lineEnd;
        const wordDuration = Math.max(1, end - start);
        body += `(${start},${wordDuration})${text}`;
        cursor = start + wordDuration;
    }
    if (!body) return null;
    return `[${lineStart},${duration}]${body}`;
};

const hasWordTimings = lines => lines.some(line => (
    Array.isArray(line?.w)
    && line.w.some(word => typeof word?.x === 'string' && word.x.trim() !== '')
));

/**
 * `result` is the `result` object of Dux's `lyrics.get` IPC reply.
 * Returns the subset of Folia's NowPlayingLyricPayload fields, or null when there is nothing to show.
 */
const buildDuxLyricPayload = (result) => {
    if (!result || result.found !== true) return null;

    const synced = Array.isArray(result.synced) ? result.synced : [];
    const lines = synced.filter(line => line && typeof line === 'object');
    const plain = sanitizePlain(result.plain);
    if (lines.length === 0 && !plain) return null;

    const lrcLines = [];
    const qrcLines = [];
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const text = cleanText(line.x);
        const start = toMilliseconds(line.t);
        if (text) {
            lrcLines.push(`${lrcTimestamp(start ?? 0)}${text}`);
        }
        const qrc = qrcLine(line, lines[index + 1]);
        if (qrc) qrcLines.push(qrc);
    }

    const karaoke = hasWordTimings(lines) && qrcLines.length > 0;
    const lrc = lrcLines.join('\n') || plain;
    if (!lrc && qrcLines.length === 0) return null;

    return {
        source: 'dux',
        hasLyric: Boolean(lrc || qrcLines.length > 0),
        hasTranslatedLyric: false,
        hasKaraokeLyric: karaoke,
        lrc: lrc || null,
        translatedLyric: null,
        karaokeLyric: karaoke ? qrcLines.join('\n') : null,
    };
};

module.exports = {
    buildDuxLyricPayload,
    cleanText,
    cleanWordText,
    hasWordTimings,
    lrcTimestamp,
    qrcLine,
    sanitizePlain,
    toMilliseconds,
};

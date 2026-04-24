import type { Line, VisualizerMode } from '../../types';

const createCharacterWords = (text: string, startTime: number, endTime: number) => {
    const chars = Array.from(text);
    const duration = endTime - startTime;

    return chars.map((char, index) => {
        const charStart = startTime + duration * (index / chars.length);
        const charEnd = startTime + duration * ((index + 1) / chars.length);

        return {
            text: char,
            startTime: charStart,
            endTime: charEnd,
        };
    });
};

export const VIS_PLAYGROUND_PREVIEW_LINES: Line[] = [
    {
        startTime: 0.7,
        endTime: 3.6,
        fullText: 'この愛は、すべての太陽を織り上げた。',
        translation: '这份爱编织了所有的太阳。',
        words: createCharacterWords('この愛は、すべての太陽を織り上げた。', 0.7, 3.6),
    },
    {
        startTime: 4.2,
        endTime: 7.2,
        fullText: 'This love has woven all the suns.',
        translation: '这份爱编织了所有的太阳。',
        words: [
            { text: 'This', startTime: 4.2, endTime: 4.7 },
            { text: 'love', startTime: 4.7, endTime: 5.15 },
            { text: 'has', startTime: 5.15, endTime: 5.55 },
            { text: 'woven', startTime: 5.55, endTime: 6.1 },
            { text: 'all', startTime: 6.1, endTime: 6.45 },
            { text: 'the', startTime: 6.45, endTime: 6.7 },
            { text: 'suns.', startTime: 6.7, endTime: 7.2 },
        ],
    },
    {
        startTime: 7.8,
        endTime: 10.9,
        fullText: 'Cet amour a tisse tous les soleils.',
        translation: '这份爱编织了所有的太阳。',
        words: [
            { text: 'Cet', startTime: 7.8, endTime: 8.25 },
            { text: 'amour', startTime: 8.25, endTime: 8.85 },
            { text: 'a', startTime: 8.85, endTime: 9.05 },
            { text: 'tisse', startTime: 9.05, endTime: 9.6 },
            { text: 'tous', startTime: 9.6, endTime: 10.05 },
            { text: 'les', startTime: 10.05, endTime: 10.35 },
            { text: 'soleils.', startTime: 10.35, endTime: 10.9 },
        ],
    },
    {
        startTime: 11.5,
        endTime: 14.4,
        fullText: '这份爱编织了所有的太阳。',
        translation: '这份爱编织了所有的太阳。',
        words: createCharacterWords('这份爱编织了所有的太阳。', 11.5, 14.4),
    },
];

export const VIS_PLAYGROUND_PREVIEW_LOOP_DURATION = 14.4;

const FUME_PREVIEW_START_OFFSET = 18.4 % VIS_PLAYGROUND_PREVIEW_LOOP_DURATION;

export const getVisPlaygroundPreviewStartOffset = (mode: VisualizerMode) =>
    mode === 'fume' ? FUME_PREVIEW_START_OFFSET : 0;

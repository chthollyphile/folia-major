import type { PackFrame } from './types';
import { makeCodeScene } from './code/scene';

// Repeatable test media contains only original placeholder text and synthesized analyser values.
export type FixtureName = 'demo' | 'empty' | 'long' | 'multilingual';
const lines = ['让每一首歌，都拥有自己的舞台', 'Build a little world around your music', '光は音とともに、ゆっくり流れる', 'Same words, same words — a new moment'];
export function fixtureScene(name: FixtureName = 'demo') {
    const frame = fixtureFrame(0, name);
    return makeCodeScene(name === 'empty' ? [] : lines.map((text, i) => ({
        fullText: name === 'long' ? frame.current : text, translation: fixtureFrame(i * 6, name).translation,
        startTime: i * 6, endTime: i * 6 + 5.7, words: [], isChorus: i === 2,
    })), frame.title, frame.artist, frame.album, 24);
}
export function fixtureFrame(time: number, name: FixtureName = 'demo', daylight = false, reducedMotion = false): PackFrame {
    const index = Math.floor(time / 6) % lines.length;
    const text = name === 'long' ? '很长的歌词需要在小屏幕中保持可读，标点、空格和重复的词也应该正确呈现。 '.repeat(4) : lines[index];
    return {
        time, duration: 24, title: name === 'long' ? 'A very long track title / 一首名字很长很长的歌曲' : 'Between the Lines',
        artist: 'Folia Studio', album: 'Style Pack Sessions',
        current: name === 'empty' ? '' : text,
        previous: name === 'empty' ? '' : lines[(index + 3) % 4], next: name === 'empty' ? '' : lines[(index + 1) % 4],
        translation: name === 'empty' ? '' : name === 'multilingual' ? '你好 · Hello · こんにちは · مرحبًا · 🎵' : 'Let every song have a stage of its own.',
        audio: (Math.sin(time * Math.PI * 4) + 1) / 2,
        spectrum: Array.from({ length: 32 }, (_, i) => (Math.sin(time * 3 + i * 0.6) + 1) / 2), cover: null,
        theme: daylight ? { background: '#f4f1e9', primary: '#242b27', secondary: '#616a60', accent: '#4f6745' }
            : { background: '#141e1b', primary: '#f2f0df', secondary: '#a5b6a8', accent: '#c7dc9e' },
        fontFamily: 'Arial, "Microsoft YaHei", sans-serif', fontWeight: 500, fontScale: 1,
        subtitleFontFamily: 'Arial, "Microsoft YaHei", sans-serif', subtitleFontWeight: 500, subtitleFontScale: 1,
        reducedMotion, showText: true,
    };
}

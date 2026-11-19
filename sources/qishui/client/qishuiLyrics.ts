import type { FoliumSourceLyricsResult, FoliumSourceLyricsTrack } from '@folia/folium';
import { record } from './qishuiNormalize';

// sources/qishui/client/qishuiLyrics.ts
// 汽水的歌词交原始文本轨，由宿主解析（方案 §4.5）：车机给 KRC（逐字）或 LRC，翻译轨带自己的格式（KRC 或 LRC），
// 宿主按行的开始时间把翻译对上，和迁之前 parseQishuiLyrics 的做法一样。KRC 同时交成行轨和逐字轨
// （迁之前 mainText 和 wordByWordText 都是这段原文）。

export function toQishuiLyrics(raw: unknown): FoliumSourceLyricsResult | null {
    const info = record(raw);
    const entity = record(info.lyric_entity);
    const content = typeof entity.content === 'string' ? entity.content.replace(/\u0000/g, '') : '';
    if (!content.trim()) return null;
    const translations = record(info.lang_translations);
    const translated = record(translations['zh-CN'] || translations['ZH-HANS-CN'] || Object.values(translations)[0]);
    const translation = typeof translated.content === 'string' ? translated.content : '';
    const isKrc = entity.type === 'krc';
    const track: FoliumSourceLyricsTrack = {
        format: isKrc ? 'krc' : 'lrc',
        text: content,
        ...(translation ? { translationText: translation, translationFormat: translated.type === 'krc' ? 'krc' as const : 'lrc' as const } : {}),
    };
    return isKrc ? { main: track, wordByWord: track } : { main: track };
}

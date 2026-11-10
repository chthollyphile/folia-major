import { splitCombinedTimeline } from './timelineSplitter';
import { formatLrcTimestamp } from './lrcTimestamp';

export interface EmbeddedLrcNormalizationResult {
    mainText: string;
    translationText: string;
    romanizationText?: string;
}

export interface EmbeddedUsltLikeTag {
    language?: string;
    descriptor?: string;
    text: string;
}

export interface EmbeddedStructuredLyricLine {
    start?: number;
    value?: string;
}

function isTranslationUsltTag(tag: EmbeddedUsltLikeTag): boolean {
    const language = tag.language?.toLowerCase();
    const descriptor = tag.descriptor?.toLowerCase() || '';

    return language === 'chi'
        || language === 'zho'
        || descriptor.includes('translation')
        || descriptor.includes('trans');
}

export function normalizeEmbeddedLrcText(
    textContent?: string,
    translationContent?: string
): EmbeddedLrcNormalizationResult {
    if (!textContent) {
        return { mainText: '', translationText: '' };
    }

    // 正文自己就可能是「原文/译文共用同一时间戳」的合并时间轴，这和标签里另有没有翻译无关。
    // 先无条件拆正文，再决定副轨用谁；否则译文行会留在主轨里，被当成一行行独立歌词渲染。
    // 保留独立定时译文的优先级，避免正文中不完整的译文覆盖整轨；仅纯文本标签使用拆轨结果兜底。
    const { main, trans, romanization } = splitCombinedTimeline(textContent);
    // 同时保留 LRC、增强 LRC 和 AWLRC 标签的时间戳形式；这里只区分纯文本，不重新校验歌词格式。
    const hasTranslationTimestamp = /(?:\[\d+(?::\d+){0,2}[.:]\d+\]|<\d{2}:\d{2}[.:]\d{2,3}>)/.test(translationContent || '');
    return {
        mainText: main,
        translationText: hasTranslationTimestamp ? translationContent! : trans || translationContent || '',
        romanizationText: romanization
    };
}

export function normalizeEmbeddedUsltTags(
    usltTags: EmbeddedUsltLikeTag[] | undefined
): EmbeddedLrcNormalizationResult {
    if (!usltTags?.length) {
        return { mainText: '', translationText: '' };
    }

    if (usltTags.length === 1) {
        return normalizeEmbeddedLrcText(usltTags[0].text);
    }

    const translationTag = usltTags.find(tag => isTranslationUsltTag(tag));
    if (translationTag) {
        return normalizeEmbeddedLrcText(
            usltTags.find(tag => tag !== translationTag)?.text,
            translationTag.text
        );
    }

    return normalizeEmbeddedLrcText(usltTags[0].text, usltTags[1].text);
}

export function normalizeEmbeddedStructuredLyrics(
    structuredLyrics: EmbeddedStructuredLyricLine[] | undefined
): EmbeddedLrcNormalizationResult {
    if (!structuredLyrics?.length) {
        return { mainText: '', translationText: '' };
    }

    const groups = new Map<number, string[]>();

    structuredLyrics.forEach(line => {
        const value = (line.value || '').trim();
        if (!value) {
            return;
        }

        const start = line.start || 0;
        const current = groups.get(start) || [];
        current.push(value);
        groups.set(start, current);
    });

    const mainLines: string[] = [];
    const translationLines: string[] = [];

    [...groups.entries()]
        .sort((a, b) => a[0] - b[0])
        .forEach(([start, values]) => {
            const prefix = formatLrcTimestamp(start);
            if (values[0]) {
                mainLines.push(`${prefix}${values[0]}`);
            }
            if (values[1]) {
                translationLines.push(`${prefix}${values[1]}`);
            }
        });

    return {
        mainText: mainLines.join('\n'),
        translationText: translationLines.join('\n')
    };
}

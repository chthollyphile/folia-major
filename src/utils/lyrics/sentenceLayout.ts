import type { LyricLayoutUnit } from './cjkSemanticLayout';

const CJK_REGEX = /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/;
const WESTERN_WORD_REGEX = /[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*/;

const hasCjkText = (text: string) => CJK_REGEX.test(text);

interface SentenceSplitOptions {
    text: string;
    targetCount: number;
}

class SentenceLayout implements LyricLayoutUnit {
    text: string;
    words: { text: string; startTime: number; endTime: number }[] = [];
    startTime: number = 0;
    endTime: number = 0;
    isSemantic: boolean = true;

    constructor(text: string) {
        this.text = text;
    }

    static splitIntoSentences(text: string, targetCount: number): SentenceLayout[] {
        if (targetCount <= 1 && targetCount >= 0) {
            return [new SentenceLayout(text)];
        }

        const maxLevel = targetCount === -1 ? 1 :
                         targetCount === -2 ? 2 :
                         targetCount === -3 ? 3 :
                         targetCount === -4 ? 4 :
                         targetCount === -5 ? 5 : 5;

        let sentences = [text];

        for (let level = 1; level <= maxLevel; level++) {
            if (sentences.length >= Math.abs(targetCount) && targetCount > 0) {
                break;
            }

            const newSentences: string[] = [];
            for (const sentence of sentences) {
                newSentences.push(...SentenceLayout.splitByLevel(sentence, level));
            }
            sentences = newSentences;
        }

        let result = sentences.map(s => new SentenceLayout(s));

        if (targetCount > 0 && result.length < targetCount) {
            result = SentenceLayout.secondarySplit(result, targetCount);
        }

        if (result.length > 1 && result.length > targetCount && targetCount > 0) {
            result = SentenceLayout.mergeSentences(result, targetCount);
        }

        return result;
    }

    private static splitByLevel(text: string, level: number): string[] {
        switch (level) {
            case 1:
                return SentenceLayout.splitByPunctuation(text);
            case 2:
                return SentenceLayout.splitByBracketsQuotes(text);
            case 3:
                return SentenceLayout.splitByWesternWords(text);
            case 4:
                return SentenceLayout.splitCJKBySpace(text);
            case 5:
                return SentenceLayout.splitBySpecialChars(text);
            default:
                return [text];
        }
    }

    private static splitByPunctuation(text: string): string[] {
        const allPunctRegex = /[，。；！？、…\.\,\;\!\?]+/g;
        const matches = [...text.matchAll(allPunctRegex)];
        
        if (matches.length === 0) {
            return [text];
        }

        const result: string[] = [];
        let lastIndex = 0;

        for (const match of matches) {
            const punctStart = match.index;
            const punctEnd = punctStart + match[0].length;
            
            let trailingSpaces = '';
            const afterPunct = text.slice(punctEnd);
            const spaceMatch = afterPunct.match(/^\s+/);
            if (spaceMatch) {
                trailingSpaces = spaceMatch[0];
            }
            
            const beforePunct = text.slice(lastIndex, punctStart);
            const punctWithSpaces = match[0] + trailingSpaces;
            
            if (beforePunct.length > 0) {
                result.push(beforePunct + punctWithSpaces);
            } else if (result.length > 0) {
                result[result.length - 1] += punctWithSpaces;
            } else {
                result.push(punctWithSpaces);
            }
            
            lastIndex = punctEnd + trailingSpaces.length;
        }

        if (lastIndex < text.length) {
            result.push(text.slice(lastIndex));
        }

        return result.filter(r => r.length > 0);
    }

    private static splitByWesternWords(text: string): string[] {
        if (!hasCjkText(text)) {
            return [text];
        }

        const westernBlockRegex = /[a-zA-Z0-9]+(?:[a-zA-Z0-9'\-]*[a-zA-Z0-9]+)?(?:\s+[a-zA-Z0-9]+(?:[a-zA-Z0-9'\-]*[a-zA-Z0-9]+)?)+[.,;:!?]?\s*/g;
        
        SentenceLayout.charCountCache.clear();

        let hasMultipleWordBlock = false;
        let match: RegExpExecArray | null;

        while ((match = westernBlockRegex.exec(text)) !== null) {
            const wordCount = match[0].match(/[a-zA-Z0-9]+/g)?.length || 0;
            if (wordCount > 1) {
                hasMultipleWordBlock = true;
                break;
            }
        }

        if (!hasMultipleWordBlock) {
            return [text];
        }

        westernBlockRegex.lastIndex = 0;

        const parts: string[] = [];
        let lastIndex = 0;

        while ((match = westernBlockRegex.exec(text)) !== null) {
            const blockStart = match.index;
            const blockEnd = blockStart + match[0].length;
            const beforeBlock = text.slice(lastIndex, blockStart);

            if (SentenceLayout.shouldSkipBoundary(text, beforeBlock, blockStart)) {
                parts.push(beforeBlock + match[0]);
            } else if (blockStart > lastIndex) {
                parts.push(beforeBlock);
                parts.push(match[0]);
            } else {
                parts.push(match[0]);
            }

            lastIndex = blockEnd;
        }

        if (lastIndex < text.length) {
            parts.push(text.slice(lastIndex));
        }

        return parts.length > 1 ? parts : [text];
    }

    private static charCountCache = new Map<string, number>();

    private static getGlobalCount(text: string, char: string): number {
        const key = `${text.length}:${char}`;
        if (SentenceLayout.charCountCache.has(key)) {
            return SentenceLayout.charCountCache.get(key)!;
        }
        const escaped = char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const count = (text.match(new RegExp(escaped, 'g')) || []).length;
        SentenceLayout.charCountCache.set(key, count);
        return count;
    }

    private static shouldSkipBoundary(fullText: string, beforeBlock: string, _boundaryPos: number): boolean {
        if (beforeBlock.length === 0) return false;

        const sepChar = beforeBlock[beforeBlock.length - 1];

        if (sepChar === '-') return true;
        if (sepChar === ':' || sepChar === '：' || sepChar === '/' || sepChar === '／' || sepChar === '|' || sepChar === '｜') {
            return SentenceLayout.getGlobalCount(fullText, sepChar) >= 2;
        }

        return false;
    }

    private static splitWesternPhrase(text: string): string[] {
        if (!hasCjkText(text) && text.length > 0) {
            const splitRegex = /(?<=\w[.,;:!?])(?=\s+\w)/;
            const parts = text.split(splitRegex);
            
            if (parts.length > 1) {
                return parts.filter(p => p.length > 0);
            }
        }
        
        return [text];
    }

    private static splitByBracketsQuotes(text: string): string[] {
        const pairedBrackets: [RegExp, RegExp][] = [
            [/\(/g, /\)/g],
            [/\[/g, /]/g],
            [/【/g, /】/g],
            [/「/g, /」/g],
            [/『/g, /』/g],
            [/《/g, /》/g],
        ];

        const quoteTypes: [string, string][] = [
            ['"', '"'],
            ["'", "'"],
        ];

        let result = [text];

        for (const [openRegex, closeRegex] of pairedBrackets) {
            const newResult: string[] = [];
            
            for (const segment of result) {
                const parts = SentenceLayout.extractPairedBracket(segment, openRegex, closeRegex);
                newResult.push(...parts);
            }
            
            result = newResult;
        }

        for (const [openQuote, closeQuote] of quoteTypes) {
            const newResult: string[] = [];
            
            for (const segment of result) {
                const parts = SentenceLayout.extractPairedQuotes(segment, openQuote, closeQuote);
                newResult.push(...parts);
            }
            
            result = newResult;
        }

        return result.length > 1 ? result : [text];
    }

    private static extractPairedBracket(text: string, openRegex: RegExp, closeRegex: RegExp): string[] {
        const parts: string[] = [];
        let remaining = text;

        while (true) {
            openRegex.lastIndex = 0;
            const openMatch = openRegex.exec(remaining);
            
            if (!openMatch) {
                if (remaining.length > 0) {
                    parts.push(remaining);
                }
                break;
            }

            const beforeBracket = remaining.slice(0, openMatch.index);
            if (beforeBracket.length > 0) {
                parts.push(beforeBracket);
            }

            closeRegex.lastIndex = 0;
            const afterOpen = remaining.slice(openMatch.index + openMatch[0].length);
            const closeMatch = closeRegex.exec(afterOpen);
            
            if (closeMatch) {
                const content = remaining.slice(openMatch.index, openMatch.index + openMatch[0].length + closeMatch.index + closeMatch[0].length);
                parts.push(content);
                remaining = afterOpen.slice(closeMatch.index + closeMatch[0].length);
            } else {
                parts.push(remaining.slice(openMatch.index));
                break;
            }
        }

        return parts.filter(p => p.length > 0);
    }

    private static extractPairedQuotes(text: string, openQuote: string, closeQuote: string): string[] {
        const parts: string[] = [];
        let remaining = text;
        let searchFrom = 0;

        while (searchFrom < remaining.length) {
            const openIndex = remaining.indexOf(openQuote, searchFrom);
            
            if (openIndex === -1) {
                break;
            }

            const closeIndex = remaining.indexOf(closeQuote, openIndex + 1);
            
            if (closeIndex === -1 || closeIndex === openIndex + 1) {
                searchFrom = openIndex + 1;
                continue;
            }

            if (openIndex > 0) {
                parts.push(remaining.slice(0, openIndex));
            }

            const content = remaining.slice(openIndex, closeIndex + 1);
            parts.push(content);
            
            remaining = remaining.slice(closeIndex + 1);
            searchFrom = 0;
        }

        if (remaining.length > 0) {
            parts.push(remaining);
        }

        return parts.filter(p => p.length > 0);
    }

    private static splitCJKBySpace(text: string): string[] {
        if (!hasCjkText(text)) {
            return [text];
        }

        const segments: string[] = [];
        let currentSegment = '';
        let inCjkBlock = false;

        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const isCJK = CJK_REGEX.test(char);
            const isWestern = /[a-zA-Z0-9]/.test(char);
            const isSpace = /\s/.test(char);

            if (isCJK) {
                currentSegment += char;
                inCjkBlock = true;
            } else if (isWestern) {
                // Western 字符跟随当前块（不做边界分割）
                currentSegment += char;
            } else if (isSpace) {
                // 空格处理：
                // - 全角空格 → 总是触发分割，附到前段末尾
                // - 半角空格在 CJK 后 → 分割；其他情况跟随
                const isFullWidthSpace = char === '\u3000';
                
                if (isFullWidthSpace && currentSegment.length > 0) {
                    // 全角空格：完成当前段
                    currentSegment += char;
                    segments.push(currentSegment);
                    currentSegment = '';
                    inCjkBlock = false;
                } else if (inCjkBlock && currentSegment.length > 0) {
                    // 半角空格在 CJK 块中：检查前一个字符
                    const lastChar = currentSegment[currentSegment.length - 1];
                    if (CJK_REGEX.test(lastChar)) {
                        currentSegment += char;
                        segments.push(currentSegment);
                        currentSegment = '';
                        inCjkBlock = false;
                    } else {
                        currentSegment += char;
                    }
                } else if (currentSegment.length === 0 && segments.length > 0) {
                    segments[segments.length - 1] += char;
                } else {
                    // 其他情况的空格，跟随
                    currentSegment += char;
                }
            } else {
                if (currentSegment.length === 0 && segments.length > 0) {
                    segments[segments.length - 1] += char;
                } else {
                    currentSegment += char;
                }
            }
        }

        if (currentSegment) {
            if (segments.length > 0 && /^\s+$/.test(currentSegment)) {
                segments[segments.length - 1] += currentSegment;
            } else {
                segments.push(currentSegment);
            }
        }

        return segments.length > 1 ? segments : [text];
    }

    private static splitBySpecialChars(text: string): string[] {
        const specialCharRegex = /[：:\/／\\|｜~～]+/;
        const parts = text.split(specialCharRegex);

        if (parts.filter(part => part.length > 0).length <= 1) {
            return [text];
        }

        const result: string[] = [];
        let lastIndex = 0;

        for (const part of parts) {
            const index = text.indexOf(part, lastIndex);
            if (index > lastIndex) {
                const specialChar = text.slice(lastIndex, index);
                if (result.length > 0) {
                    result[result.length - 1] += specialChar;
                } else {
                    result.push(specialChar);
                }
            }
            
            if (part) {
                result.push(part);
                lastIndex = index + part.length;
            } else if (index !== -1) {
                lastIndex = index;
            }
        }

        if (lastIndex < text.length) {
            const tail = text.slice(lastIndex);
            if (tail && result.length > 0) {
                result[result.length - 1] += tail;
            } else if (tail) {
                result.push(tail);
            }
        }

        return result.filter(r => r.length > 0);
    }

    private static secondarySplit(sentences: SentenceLayout[], targetCount: number): SentenceLayout[] {
        while (sentences.length < targetCount) {
            const candidates = sentences.filter(s => s.text.length > 2);
            if (candidates.length === 0) break;

            const pseudoRandom = (seed: number) => {
                const x = Math.sin(seed) * 10000;
                return x - Math.floor(x);
            };

            const seed = Date.now() + sentences.length;
            const randomIndex = Math.floor(pseudoRandom(seed) * candidates.length);
            const selectedCandidate = candidates[randomIndex];

            const candidateIndex = sentences.indexOf(selectedCandidate);
            const midPoint = Math.floor(selectedCandidate.text.length / 2);

            const firstHalf = selectedCandidate.text.slice(0, midPoint);
            const secondHalf = selectedCandidate.text.slice(midPoint);

            sentences.splice(candidateIndex, 1, 
                new SentenceLayout(firstHalf),
                new SentenceLayout(secondHalf)
            );
        }

        return sentences;
    }

    private static mergeSentences(sentences: SentenceLayout[], targetCount: number): SentenceLayout[] {
        while (sentences.length > targetCount) {
            let bestMergeIndex = 0;
            let shortestCombinedLength = Infinity;

            for (let i = 0; i < sentences.length - 1; i++) {
                const combinedLength = sentences[i].text.length + sentences[i + 1].text.length;
                if (combinedLength < shortestCombinedLength) {
                    shortestCombinedLength = combinedLength;
                    bestMergeIndex = i;
                }
            }

            const merged = new SentenceLayout(
                sentences[bestMergeIndex].text + sentences[bestMergeIndex + 1].text
            );

            sentences.splice(bestMergeIndex, 2, merged);
        }

        return sentences;
    }
}

export { SentenceLayout };
export type { SentenceSplitOptions };
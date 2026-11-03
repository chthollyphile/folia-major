// src/utils/lyrics/textDirection.ts
// 一行歌词的书写方向：按第一个有方向的字母判断（维吾尔、阿拉伯、希伯来等文字从右往左写）。

export type LyricTextDirection = 'ltr' | 'rtl';

// Scripts written right to left. A letter from any other script is strong left-to-right; digits,
// punctuation and spaces are neutral and skipped, like the first-strong rule of the Unicode
// bidi algorithm (and the browser's dir="auto").
const RTL_LETTER_RE = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}\p{Script=Adlam}\p{Script=Hanifi_Rohingya}\p{Script=Yezidi}]/u;
const LETTER_RE = /\p{L}/u;

/**
 * The base direction of one lyric line, from its first letter. Whole-line only: words are placed
 * right to left when this says 'rtl', but a Latin run or number embedded in an RTL line is not
 * reordered on its own (that needs the full bidi algorithm).
 */
export const resolveLyricTextDirection = (text: string): LyricTextDirection => {
    for (const char of text) {
        if (!LETTER_RE.test(char)) continue;
        return RTL_LETTER_RE.test(char) ? 'rtl' : 'ltr';
    }
    return 'ltr';
};

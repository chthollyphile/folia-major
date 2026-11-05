// src/utils/lyrics/hanKanaText.ts
// Han and kana detection for lyric text: the scripts icu-folia and the AI word split cut
// differently from plain ICU, so the features that only matter there ask this first.

/** Han, hiragana or katakana anywhere in the text. */
export const HAN_OR_KANA = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

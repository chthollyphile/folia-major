// src/library/suites/bravais/bravaisSeamTabLabels.ts
// 首页窄缝页签的「一个字」短形（fb2）：纵向放不下全名时，页签缩成一个字，全名留在 title / aria-label。
// 不加 locale key，从已翻译的全名推：取第一个字素（Intl.Segmenter），拉丁字母转大写——
// 中文「歌单 / 电台 / 专辑 / 本地」→「歌 / 电 / 专 / 本」，「Navi」→「N」；英文 Playlists / Radio / Albums / Folder / Navi
// → P / R / A / F / N，印尼文 Playlist / Radio / Album / Folder / Navi 同样。短形撞车时（两个页签同一个首字）撞车的
// 那几个改取两个字素：首字，加上它们之间第一个分得开的位置上的那个字——多数时候就是第二个字（Albums / Artists →
// Al / Ar），前几个字都一样时往后找（Folia / Folder 的前三个字相同 → Fi / Fd）。仍然很短、但分得开。

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

/** 全名的字素（去掉首尾空白）。 */
const graphemesOf = (label: string): string[] => {
    const text = label.trim();
    return segmenter ? Array.from(segmenter.segment(text), part => part.segment) : Array.from(text);
};

/** 全名的前 n 个字素。 */
const leadingGraphemes = (label: string, count: number): string => graphemesOf(label).slice(0, count).join('');

const upperInitial = (text: string): string => text.charAt(0).toLocaleUpperCase() + text.slice(1);

/** 一个页签的短形：第一个字素，字母转大写（中日韩字不受影响）。 */
export const abbreviateSeamTabLabel = (label: string, length = 1): string => {
    return upperInitial(leadingGraphemes(label, length));
};

/**
 * 首字相同的一组页签各自的两字短形：首字 + 第 k 个字，k 取让这一组互不相同的最靠前的位置（比较时不分大小写）。
 * 找不到这样的位置（全名本身就相同，或一个是另一个的开头而别的又撞上）时，退回各取前两个字。
 */
const disambiguate = (labels: readonly string[]): string[] => {
    const all = labels.map(graphemesOf);
    const longest = Math.max(...all.map(graphemes => graphemes.length));
    for (let position = 1; position < longest; position += 1) {
        const shorts = all.map(graphemes => (graphemes[0] ?? '') + (graphemes[position] ?? ''));
        if (new Set(shorts.map(short => short.toLocaleLowerCase())).size === shorts.length) return shorts.map(upperInitial);
    }
    return labels.map(label => abbreviateSeamTabLabel(label, 2));
};

/** 一组页签的短形（与输入同序）：撞车的改取两个字素（见 disambiguate）。 */
export const abbreviateSeamTabLabels = (labels: readonly string[]): string[] => {
    const shorts = labels.map(label => abbreviateSeamTabLabel(label));
    const groups = new Map<string, number[]>();
    shorts.forEach((short, index) => groups.set(short, [...(groups.get(short) ?? []), index]));
    for (const indexes of groups.values()) {
        if (indexes.length < 2) continue;
        const resolved = disambiguate(indexes.map(index => labels[index]));
        indexes.forEach((index, order) => { shorts[index] = resolved[order]; });
    }
    return shorts;
};

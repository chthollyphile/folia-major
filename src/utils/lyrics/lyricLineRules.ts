import type { Line, LyricData } from '../../types';
import { compileLyricFilterPattern, getLyricFilterError, LYRIC_FILTER_REGEX_EXAMPLE } from './filtering';
import { finalizeParsedLyricLines, isInterludeLine } from './parserCore';
import { ensureLyricDataRenderHints } from './renderHints';

// src/utils/lyrics/lyricLineRules.ts
// The listener's rules for removing lyric lines. A rule is some words and how a line must hold
// one of them (starts with, contains, is, ends with), a ready-made word list, or an expression written by
// hand; the expression saved by older versions becomes one written rule. A line goes when any rule
// that is on matches its full text. Applied where lyrics are shown, never where they are parsed or
// cached, so a change of the rules needs no new fetch.

export type LyricLineRuleShape = 'starts' | 'contains' | 'whole' | 'ends' | 'preset' | 'written';

export interface LyricLineRule {
    id: string;
    on: boolean;
    shape: LyricLineRuleShape;
    /** The words, one to a line (lyricLineRuleWords); a preset's id for 'preset'; the expression for 'written'. */
    text: string;
    /** 'starts' only: the words are followed by a colon. */
    colon?: boolean;
    /** Lines in the middle of a song stay (isMidSongLine). */
    edgesOnly?: boolean;
}

/** A rule before it has an id and a switch: what a suggestion or a menu item makes. */
export type LyricLineRuleDraft = Omit<LyricLineRule, 'id' | 'on'>;

/** The id of the rule the single expression of older versions became. */
export const LEGACY_LYRIC_RULE_ID = 'legacy';

/** What is saved, as text: the rules, and the expression and switch older versions saved (null where nothing is). */
export interface StoredLyricFilterSetting {
    rules: string | null;
    pattern: string | null;
    enabled: string | null;
}

/** Ready-made rules: a line holding any of the words goes. */
export const LYRIC_LINE_PRESETS = [
    { id: 'copyright', words: ['版权所有', '未经许可', '未经授权', '不得翻唱', '禁止翻唱', '侵权必究', 'all rights reserved', 'copyright', '©', '℗'] },
    { id: 'lyricSource', words: ['歌词贡献者', '翻译贡献者', '歌词来源', '歌词来自', '歌词提供', '歌词制作', '歌词校对', 'lrc by'] },
] as const;

const SHAPES: readonly LyricLineRuleShape[] = ['starts', 'contains', 'whole', 'ends', 'preset', 'written'];

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let nextIdSeed = 0;
export const createLyricLineRuleId = (): string => `rule-${Date.now().toString(36)}-${(nextIdSeed += 1).toString(36)}`;

export const getLyricLinePresetWords = (id: string): readonly string[] | null => (
    LYRIC_LINE_PRESETS.find(preset => preset.id === id)?.words ?? null
);

/** Full-width ASCII (ＯＰ：) as ASCII; one character for one, so a match's position is the same in the line as shown. */
const foldWidth = (text: string): string => (
    text.replace(/[\uFF01-\uFF5E]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
);

/** A line as a rule tests it: a written rule as it is, the others with full width folded. */
export const lyricLineAsRuleSees = (rule: Pick<LyricLineRuleDraft, 'shape'>, text: string): string => (
    rule.shape === 'written' ? text : foldWidth(text)
);

/** The words of a rule by words (starts, contains, whole, ends), one to a line of its text: a line matches any of them. */
export const lyricLineRuleWords = (text: string): string[] => [...new Set(text.split('\n').map(word => word.trim()).filter(Boolean))];

/** A rule's text with `word` added to its words, once. */
export const withLyricLineRuleWord = (text: string, word: string): string => lyricLineRuleWords(`${text}\n${word}`).join('\n');

/**
 * The expression a rule tests each line with, or null when it removes nothing (no words, an
 * unknown preset, an expression that is not valid). Words match ignoring upper/lower case and
 * full width (ＯＰ： is OP:), the line being folded the same way (lyricLineAsRuleSees); a written rule
 * is compiled exactly as the single expression of older versions was.
 */
export const compileLyricLineRule = (rule: LyricLineRuleDraft): RegExp | null => {
    if (rule.shape === 'written') {
        return compileLyricFilterPattern(rule.text);
    }
    if (rule.shape === 'preset') {
        const words = getLyricLinePresetWords(rule.text);
        return words ? new RegExp(words.map(word => escapeRegExp(foldWidth(word))).join('|'), 'i') : null;
    }
    const words = lyricLineRuleWords(foldWidth(rule.text));
    if (words.length === 0) {
        return null;
    }
    // (Longest first: of two words at one place, the card marks the whole of the longer.)
    const body = `(?:${words.sort((one, other) => other.length - one.length).map(escapeRegExp).join('|')})`;
    switch (rule.shape) {
        case 'starts':
            return new RegExp(`^\\s*${body}${rule.colon ? '\\s*[:：]' : ''}`, 'i');
        case 'whole':
            return new RegExp(`^\\s*${body}\\s*$`, 'i');
        case 'ends':
            return new RegExp(`${body}\\s*$`, 'i');
        default:
            return new RegExp(body, 'i');
    }
};

/** Why a written rule removes nothing, or null. */
export const getLyricLineRuleError = (rule: LyricLineRuleDraft): string | null => (
    rule.shape === 'written' ? getLyricFilterError(rule.text) : null
);

export interface CompiledLyricLineRule {
    rule: LyricLineRule;
    regex: RegExp;
}

/** The rules that are on and remove something, in order. */
export const compileLyricLineRules = (rules: readonly LyricLineRule[]): CompiledLyricLineRule[] => rules.flatMap((rule) => {
    if (!rule.on) {
        return [];
    }
    const regex = compileLyricLineRule(rule);
    return regex ? [{ rule, regex }] : [];
});

/** A line after the first quarter and before the last tenth of a song's lines. Rough: it only warns, or spares with edgesOnly. */
export const isMidSongLine = (index: number, total: number): boolean => (
    index >= Math.ceil(total / 4) && index < total - Math.ceil(total / 10)
);

/** Whether one rule removes the line at `index` of `total` (a song's lines without interludes). */
export const lyricLineRuleHits = (compiled: CompiledLyricLineRule, text: string, index: number, total: number): boolean => (
    !(compiled.rule.edgesOnly && isMidSongLine(index, total))
    && compiled.regex.test(lyricLineAsRuleSees(compiled.rule, text))
);

/** Per line, the first rule that removes it, or null. `lines` are a song's lines without interludes. */
export const matchLyricLines = (
    lines: readonly Pick<Line, 'fullText'>[],
    compiled: readonly CompiledLyricLineRule[],
): (CompiledLyricLineRule | null)[] => lines.map((line, index) => (
    compiled.find(entry => lyricLineRuleHits(entry, line.fullText, index, lines.length)) ?? null
));

/**
 * The lyrics without the lines the rules remove, interludes rebuilt around what is left. Without a
 * rule that removes anything they come back as they are, with render hints ensured.
 */
export const applyLyricLineRules = (
    lyrics: LyricData | null | undefined,
    compiled: readonly CompiledLyricLineRule[],
): LyricData | null => {
    if (!lyrics) {
        return null;
    }
    if (compiled.length === 0) {
        return ensureLyricDataRenderHints(lyrics);
    }
    const lines = lyrics.lines.filter(line => !isInterludeLine(line));
    const hits = matchLyricLines(lines, compiled);
    return {
        ...lyrics,
        lines: finalizeParsedLyricLines(lines.filter((_, index) => !hits[index]), { includeInterludes: true }),
    };
};

// Lyrics laid out for the screen → the lyrics they were laid out from, before any rule ran. Lyrics
// already shown come back to the setter (a cancelled blend, a stage snapshot, the preview loader's
// fallback after 保存); it lays them out again from these, so the rules in force now run once, on
// the original lines, and a rule switched off brings its lines back. In memory only: a window
// hand-over sends these source lyrics instead.
const sourcesBeforeRules = new WeakMap<LyricData, LyricData>();

/** The lyrics `lyrics` were laid out from, before the rules; anything else is returned as is. */
export const lyricsBeforeRules = (lyrics: LyricData | null): LyricData | null => (
    lyrics ? sourcesBeforeRules.get(lyrics) ?? lyrics : lyrics
);

/** Records that `laidOut` was made from `source`, or from what `source` itself was laid out from. */
export const rememberLyricsBeforeRules = (laidOut: LyricData, source: LyricData): LyricData => {
    sourcesBeforeRules.set(laidOut, sourcesBeforeRules.get(source) ?? source);
    return laidOut;
};

/**
 * Up to three rules built from a line the listener clicked, narrowest first: the words before its
 * colon (or its first word) at the start, the line itself, and those words anywhere.
 */
export const suggestLyricLineRules = (text: string): LyricLineRuleDraft[] => {
    const line = text.trim();
    if (!line) {
        return [];
    }
    const colonHead = line.match(/^([^:：]{1,16})[:：]/)?.[1].trim();
    const firstWord = line.split(/\s+/)[0];
    const head = colonHead || (firstWord !== line ? firstWord : '');
    const drafts: LyricLineRuleDraft[] = [];
    if (head) {
        drafts.push(colonHead ? { shape: 'starts', text: head, colon: true } : { shape: 'starts', text: head });
    }
    drafts.push({ shape: 'whole', text: line });
    drafts.push({ shape: 'contains', text: head || line });
    return drafts;
};

/**
 * The same words held more narrowly: at the start and followed by a colon. Only a contains rule
 * (its own trailing colon dropped from the words) or a starts rule with no colon has one: for the
 * other shapes it would remove other lines, not fewer.
 */
export const narrowerLyricLineRule = (rule: LyricLineRuleDraft): LyricLineRuleDraft | null => {
    const words = lyricLineRuleWords(rule.text);
    const bare = lyricLineRuleWords(words.map(word => word.replace(/\s*[:：]$/, '')).join('\n'));
    const narrows = rule.shape === 'contains' || (rule.shape === 'starts' && !rule.colon && words.every(word => !/[:：]$/.test(word)));
    return narrows && bare.length > 0 ? { shape: 'starts', text: bare.join('\n'), colon: true } : null;
};

/** The old built-in example expression, which the window names in words instead. */
export const isLegacyExamplePattern = (text: string): boolean => text.trim() === LYRIC_FILTER_REGEX_EXAMPLE;

const readRule = (value: unknown): LyricLineRule | null => {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const item = value as Record<string, unknown>;
    if (typeof item.id !== 'string' || typeof item.text !== 'string' || !SHAPES.includes(item.shape as LyricLineRuleShape)) {
        return null;
    }
    return {
        id: item.id,
        on: item.on !== false,
        shape: item.shape as LyricLineRuleShape,
        text: item.text,
        ...(item.colon === true ? { colon: true } : {}),
        ...(item.edgesOnly === true ? { edgesOnly: true } : {}),
    };
};

const parseStoredItems = (raw: string | null): unknown[] | null => {
    if (raw === null) {
        return null;
    }
    try {
        const value: unknown = JSON.parse(raw);
        return Array.isArray(value) ? value : null;
    } catch {
        return null;
    }
};

/**
 * The saved rules. Without any (a listener of an older version), the old expression becomes one
 * written rule with the old switch, so the same lines go without the listener doing anything.
 * Nothing is written here: the old keys stay as they are until the listener saves.
 */
export const readLyricLineRules = (stored: StoredLyricFilterSetting): LyricLineRule[] => {
    const items = parseStoredItems(stored.rules);
    if (items) {
        return items.flatMap(item => readRule(item) ?? []);
    }
    const pattern = stored.pattern?.trim() || '';
    if (!pattern) {
        return [];
    }
    return [{ id: LEGACY_LYRIC_RULE_ID, on: stored.enabled === null || stored.enabled === 'true', shape: 'written', text: pattern }];
};

/**
 * What to save for `rules`: them, then the saved items this version cannot read (from a later
 * version, or damaged), unchanged, so a save here does not erase them. A rule keeps the fields of its
 * saved item that this version does not know (a later version's). `stored` is what is saved now.
 */
export const storedLyricLineRules = (rules: readonly LyricLineRule[], stored: string | null): string => {
    const items = parseStoredItems(stored) ?? [];
    const savedById = new Map(items.flatMap(item => {
        const rule = readRule(item);
        return rule ? [[rule.id, item as Record<string, unknown>] as const] : [];
    }));
    return JSON.stringify([
        // The switches this version knows are written as the rule has them: one turned off goes.
        ...rules.map(rule => ({ ...savedById.get(rule.id), ...rule, colon: rule.colon || undefined, edgesOnly: rule.edgesOnly || undefined })),
        ...items.filter(item => !readRule(item)),
    ]);
};

/**
 * Equal for two lists of rules that remove the same lines: the ids, the order of the rules and the
 * order of the words in one do not count.
 */
export const lyricLineRulesKey = (rules: readonly LyricLineRule[]): string => JSON.stringify(rules.map(rule => JSON.stringify([
    rule.on,
    rule.shape,
    rule.shape === 'preset' || rule.shape === 'written' ? rule.text.trim() : lyricLineRuleWords(rule.text).sort(),
    rule.shape === 'starts' && Boolean(rule.colon),
    Boolean(rule.edgesOnly),
])).sort());

/** What the old keys hold for these rules: the old rule's expression and switch, or nothing once it was deleted. */
export const legacyLyricFilterSetting = (rules: readonly LyricLineRule[]): { pattern: string; enabled: boolean } | null => {
    const legacy = rules.find(rule => rule.id === LEGACY_LYRIC_RULE_ID && rule.shape === 'written');
    const pattern = legacy?.text.trim();
    return legacy && pattern ? { pattern, enabled: legacy.on } : null;
};

import { getAvailableCommandPaletteCommands } from '../commandRegistry';
import { getCommandFrequencyBonus } from '../commandFrequency';
import { DEFAULT_LANDING_COMMAND_IDS } from '../commands';
import type { CommandPaletteCommand, CommandPaletteContext, CommandPaletteMatch } from '../types';
import { getCommandSearchIndex, type CommandSearchEntry } from './commandSearchIndex';
import { scoreSubsequence } from './fuzzyScore';
import { normalizeSearchText, splitWords } from './normalize';

// src/components/command-palette/search/rankCommands.ts
// 命令面板的排序：分档匹配 + 落地列表。取代原来的 commandMatching.ts。
//
// 四个既有档位（exact/prefix/input/contains）语义逐字保留，只是词源从手写 keywords 换成了
// 索引里的触发词。新增的 fuzzy 是**最低档**：今天能匹配上的一律仍落在 1-4 档，模糊匹配只可能
// 出现在它们之下。这是构造性保证，不依赖回归测试去发现排序倒退。

const MAX_COMMAND_MATCHES = 10;

const MATCH_QUALITY = {
    fuzzy: 0,
    contains: 1,
    prefix: 2,
    input: 3,
    exact: 4,
} as const;

const NO_MATCH = -1;

/**
 * 弱信号的同档扣分。档位不变（否则今天能匹配的东西会掉档），只在档内让位。
 *
 * 标题词：从标题机械切出来的单词，弱于有人专门写下的同义词。
 * 首字母：两三个字母，碰撞率最高，最弱。
 */
const TITLE_WORD_PENALTY = 20;
const INITIALS_PENALTY = 25;
const MIN_INITIALS_QUERY_LENGTH = 2;
const MIN_FUZZY_QUERY_LENGTH = 2;
const MAX_FUZZY_SCORE = 50;

/** 模糊档只对纯 ASCII 查询开放：CJK 查询要么子串命中，要么子序列结果纯属噪声。 */
const ASCII_QUERY = /^[a-z0-9 ]+$/;

type RankedCommandPaletteMatch = CommandPaletteMatch & {
    matchQuality: number;
};

// 空输入时先显示最近使用，再是声明的落地集合，最后按注册顺序补齐。把落地集合显式声明出来，
// 是为了让「面板刚打开时显示什么」不取决于某条命令恰好排在分组文件的哪一行。
const buildLandingCommands = (
    filteredCommands: CommandPaletteCommand[],
    recentCommandIds: string[],
): CommandPaletteMatch[] => {
    const recentCommands = recentCommandIds
        .map(commandId => filteredCommands.find(command => command.id === commandId))
        .filter((command): command is CommandPaletteCommand => command !== undefined);
    const taken = new Set(recentCommands.map(command => command.id));

    const landingCommands = DEFAULT_LANDING_COMMAND_IDS
        .map(commandId => filteredCommands.find(command => command.id === commandId))
        .filter((command): command is CommandPaletteCommand => command !== undefined && !taken.has(command.id));
    landingCommands.forEach(command => taken.add(command.id));

    const remaining = filteredCommands.filter(command => !taken.has(command.id));

    return [...recentCommands, ...landingCommands, ...remaining]
        .slice(0, MAX_COMMAND_MATCHES)
        .map((command, index) => ({
            command,
            score: recentCommandIds.includes(command.id) ? 130 - index : 100 - index,
            input: '',
        }));
};

/**
 * `input` 档命中后，问号后面剩下的那段用户输入。
 *
 * 按**词数**切而不是按字符长度切。原实现是 `query.trim().slice(keyword.length)`，拿原始查询按
 * 原始关键词的长度去切：查询里有折叠空白（`search   touhou`）或关键词自身含多余空白时，偏移就错了。
 * 数词法对这两种情况都免疫，同时保留用户输入的原始大小写。
 */
const sliceInputAfterTerm = (query: string, term: string): string => {
    const termWordCount = splitWords(term).length;
    return query.trim().split(/\s+/).slice(termWordCount).join(' ');
};

const scoreEntry = (
    entry: CommandSearchEntry,
    normalizedQuery: string,
    rawQuery: string,
    frequencyCounts: Record<string, number>,
): RankedCommandPaletteMatch | null => {
    let tier: number = NO_MATCH;
    let score = 0;
    let input = '';
    let matchedTermLength = 0;
    // A command that takes no input reads the words after a term as more of its name: each must be in its text.
    const restFoundInText = (term: string) => splitWords(normalizedQuery.slice(term.length))
        .every(word => entry.haystack.includes(word));

    /**
     * `allowExact` 是标题词与同义词的分界线。
     *
     * 输入 `queue` 不是命令「Panel: queue」的精确匹配，只是命中了它标题里的一个词——所以标题词
     * 最高只到 prefix 档。光靠档内扣分不够：比较器先比档、再比 recency、最后才比分数，所以只要
     * 标题词能进 exact 档，一条最近用过的 `panel-queue` 就会压过 `queue` 命令本身。
     */
    const scoreTerms = (terms: string[], penalty: number, allowExact: boolean) => {
        for (const term of terms) {
            if (normalizedQuery === term) {
                tier = Math.max(tier, allowExact ? MATCH_QUALITY.exact : MATCH_QUALITY.prefix);
                score = Math.max(score, (allowExact ? 120 : 100 - term.length) - penalty);
            } else if (term.startsWith(normalizedQuery)) {
                tier = Math.max(tier, MATCH_QUALITY.prefix);
                score = Math.max(score, 100 - term.length - penalty);
            } else if (normalizedQuery.startsWith(`${term} `) && (entry.command.requiresInput || restFoundInText(term))) {
                tier = Math.max(tier, MATCH_QUALITY.input);
                score = Math.max(score, 90 + term.length + (entry.command.requiresInput ? 20 : 0) - penalty);
                if (term.length > matchedTermLength) {
                    matchedTermLength = term.length;
                    input = sliceInputAfterTerm(rawQuery, term);
                }
            } else if (term.includes(normalizedQuery)) {
                tier = Math.max(tier, MATCH_QUALITY.contains);
                score = Math.max(score, 60 - term.indexOf(normalizedQuery) - penalty);
            }
        }
    };

    scoreTerms(entry.triggers, 0, true);
    scoreTerms(entry.titleWords, TITLE_WORD_PENALTY, false);

    if (normalizedQuery.length >= MIN_INITIALS_QUERY_LENGTH) {
        for (const initial of entry.initials) {
            if (normalizedQuery === initial) {
                tier = Math.max(tier, MATCH_QUALITY.exact);
                score = Math.max(score, 120 - INITIALS_PENALTY);
            } else if (initial.startsWith(normalizedQuery)) {
                tier = Math.max(tier, MATCH_QUALITY.prefix);
                score = Math.max(score, 100 - initial.length - INITIALS_PENALTY);
            }
        }
    }

    // 触发词都没到 contains 档时，再看整段语料（本地化 title/description + 拼音文本）。
    if (tier < MATCH_QUALITY.contains) {
        const at = entry.haystack.indexOf(normalizedQuery);
        if (at >= 0) {
            tier = MATCH_QUALITY.contains;
            score = Math.max(score, 55 - Math.min(at, 40));
        } else {
            // 几个词分开打（「停用 某平台」「某平台 匹配」）：每个词都在语料里也算 contains，比整段连着出现的低一档分。
            // 单个 ASCII 字母在很多命令的语料里都能碰上，不算词（留给 fuzzy 档）；一个汉字算。
            const words = splitWords(normalizedQuery);
            const meaningful = (word: string) => word.length >= 2 || /[^\p{ASCII}]/u.test(word);
            if (words.length > 1 && words.every(meaningful) && words.every(word => entry.haystack.includes(word))) {
                tier = MATCH_QUALITY.contains;
                score = Math.max(score, 45 - Math.min(entry.haystack.indexOf(words[0]), 30));
            }
        }
    }

    if (tier === NO_MATCH) {
        const condensed = normalizedQuery.replace(/ /g, '');
        if (ASCII_QUERY.test(normalizedQuery) && condensed.length >= MIN_FUZZY_QUERY_LENGTH) {
            // 逐字段取最高分。绝不能对拼接串打分——见 fuzzyScore.ts 的说明。
            let best: number | null = null;
            for (const target of entry.fuzzyTargets) {
                const fuzzy = scoreSubsequence(target, condensed);
                if (fuzzy !== null && (best === null || fuzzy > best)) {
                    best = fuzzy;
                }
            }
            if (best !== null) {
                tier = MATCH_QUALITY.fuzzy;
                score = Math.min(MAX_FUZZY_SCORE, best);
            }
        }
    }

    if (tier === NO_MATCH) {
        return null;
    }

    // 频次加成只加在这里，也就是比较器的第三个键。它跨不了档，也压不过 recency ——
    // 比较器第二步在任一方出现在最近列表里时就短路了，第三步只在双方都不在最近列表时才执行。
    const bonus = getCommandFrequencyBonus(frequencyCounts, entry.command.id);
    return { command: entry.command, score: score + bonus, input, matchQuality: tier };
};

/**
 * 对**已过滤**的命令列表排序。
 *
 * 从 getCommandPaletteMatches 拆出来，好让已经算过可用集的调用方（面板 hook）把结果直接递进来，
 * 而不是让这里再问一次注册表——那一次多余的可用性扫描原本每次击键都在跑。
 */
export const rankCommands = (
    query: string,
    filteredCommands: CommandPaletteCommand[],
    recentCommandIds: string[] = [],
    locale = 'en',
    frequencyCounts: Record<string, number> = {},
): CommandPaletteMatch[] => {
    const normalizedQuery = normalizeSearchText(query);

    if (!normalizedQuery) {
        return buildLandingCommands(filteredCommands, recentCommandIds);
    }

    const index = getCommandSearchIndex(filteredCommands, locale);

    const recentCommandRanks = new Map<string, number>();
    recentCommandIds.forEach((commandId, position) => {
        if (!recentCommandRanks.has(commandId)) {
            recentCommandRanks.set(commandId, position);
        }
    });

    const matches = index.entries
        .map(entry => scoreEntry(entry, normalizedQuery, query, frequencyCounts))
        .filter((match): match is RankedCommandPaletteMatch => match !== null)
        .sort((a, b) => {
            if (a.matchQuality !== b.matchQuality) {
                return b.matchQuality - a.matchQuality;
            }

            const aRecentRank = recentCommandRanks.get(a.command.id);
            const bRecentRank = recentCommandRanks.get(b.command.id);
            if (aRecentRank !== undefined || bRecentRank !== undefined) {
                if (aRecentRank === undefined) return 1;
                if (bRecentRank === undefined) return -1;
                if (aRecentRank !== bRecentRank) return aRecentRank - bRecentRank;
            }

            return b.score - a.score || a.command.title.localeCompare(b.command.title);
        });

    return matches.slice(0, MAX_COMMAND_MATCHES);
};

/** 公开入口，签名不变：先解出可用集，再排序。 */
export const getCommandPaletteMatches = (
    query: string,
    context?: CommandPaletteContext,
    recentCommandIds: string[] = [],
): CommandPaletteMatch[] => rankCommands(query, getAvailableCommandPaletteCommands(context), recentCommandIds);

/**
 * 不截断、不含模糊档的命中集合，按注册表顺序。
 *
 * 给设置侧栏的搜索用：它问的是「哪些设置命令认得这个词」，要的是全集而不是面板里的前十条；
 * 模糊档在这里只会把不相干的分区拉进结果，所以只收子串及以上的命中。
 */
export const matchCommandsExactly = (
    query: string,
    commands: CommandPaletteCommand[],
    locale = 'en',
): CommandPaletteCommand[] => {
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) {
        return [];
    }
    return getCommandSearchIndex(commands, locale).entries
        .filter(entry => (scoreEntry(entry, normalizedQuery, query, {})?.matchQuality ?? NO_MATCH) > MATCH_QUALITY.fuzzy)
        .map(entry => entry.command);
};

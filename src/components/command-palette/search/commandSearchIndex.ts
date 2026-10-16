import { PINYIN_BY_PHRASE } from 'virtual:folia-command-pinyin';
import en from '../../../i18n/locales/en';
import zhCN from '../../../i18n/locales/zh-CN';
import ind from '../../../i18n/locales/in';
import vi from '../../../i18n/locales/vi';
import type { CommandPaletteCommand } from '../types';
import { normalizeSearchText, splitWords } from './normalize';

// src/components/command-palette/search/commandSearchIndex.ts
// 把命令注册表编译成检索用的索引：每条命令一份预规范化的触发词、拼音首字母和语料。
//
// 这取代了原来「只扫 command.keywords，且每次击键把全部约 780 个关键词重新规范化一遍」的做法。
// 现在关键词只承载**人写的同义词**，检索主体是本地化 title/description 加构建期生成的拼音。
//
// 语料的语言策略（见计划）：
//   - 恒定入索引：手写同义词、英文 title/description、zh-CN 文案派生的拼音
//   - 随当前语言变：该语言的 title/description
// 拼音是独立的一条常开车道，与界面语言无关——英文界面下打 shezhi 一样要能命中。

type LocaleCommandText = Record<string, { title?: string; description?: string }>;

const LOCALE_COMMAND_TEXT: Record<string, LocaleCommandText> = {
    en: ((en as any).commandPalette?.commands ?? {}) as LocaleCommandText,
    'zh-CN': ((zhCN as any).commandPalette?.commands ?? {}) as LocaleCommandText,
    in: ((ind as any).commandPalette?.commands ?? {}) as LocaleCommandText,
    vi: ((vi as any).commandPalette?.commands ?? {}) as LocaleCommandText,
};

const CJK = /[一-鿿㐀-䶿]/;

/** 触发词最短要求：英文标题里的单字/双字词（of、to、a）当触发词只会制造噪声。 */
const MIN_TITLE_WORD_LENGTH = 3;

export type CommandSearchEntry = {
    command: CommandPaletteCommand;
    /**
     * 参与 exact / prefix / input / contains 四档的触发词，全额计分。来源都是「有人刻意写下的
     * 检索词」：手写同义词、同义词的拼音、以及完整的本地化标题。已规范化、去重、按长度升序。
     */
    triggers: string[];
    /**
     * 从标题里切出来的单词。走同样的四档，但**扣分**。
     *
     * 不扣分会出事：`Panel: queue` 切出的 `queue` 会和 `queue` 命令自己写的同义词 `queue` 打成
     * 平手（都是 exact、都是 120 分），最后由标题的字典序决定谁排前面——`Panel: queue` <
     * `Queue`，于是输入 queue 排第一的是面板而不是队列。`search` / `player` 也是同一个坑。
     * 从标题里机械切出来的词，本来就该弱于有人专门写下的别名。
     */
    titleWords: string[];
    /** 拼音首字母。只参与 prefix/exact，且查询至少 2 个字符，见 rankCommands。 */
    initials: string[];
    /** contains 档的语料。字段之间用 ' | ' 隔开，避免子串跨字段假命中。 */
    haystack: string;
    /**
     * 模糊档的语料，**逐字段分开**：标题和触发词各是一条，不含 description。
     *
     * 拼成一整串会让子序列匹配失去意义——某条命令的标题+同义词+拼音拼起来后，光拼音里就有
     * 12 个 z，`zzzzzzzzzzzz` 于是成了它的合法子序列。逐字段打分再取最高，既保住了语义，
     * 也让长度惩罚回到有效量级。
     */
    fuzzyTargets: string[];
    /** 取代 command.keywords[0]：UI 上那个等宽提示 chip 和「全部命令」点击回填都用它。 */
    primaryTerm: string;
};

export type CommandSearchIndex = {
    entries: CommandSearchEntry[];
    /**
     * 触发词 -> 命令，注册表顺序。空格转 pill 的效果每次原始击键都会跑（不在 120ms 防抖后面），
     * 必须是 O(1) 查表而不是扫注册表。
     */
    triggerIndex: Map<string, CommandPaletteCommand[]>;
    byId: Map<string, CommandSearchEntry>;
};

const localeText = (locale: string, commandId: string) => LOCALE_COMMAND_TEXT[locale]?.[commandId];

const pinyinOf = (phrase: string) => PINYIN_BY_PHRASE[phrase];

const pushUnique = (sink: Set<string>, value: string | undefined | null) => {
    if (!value) {
        return;
    }
    const normalized = normalizeSearchText(value);
    if (normalized) {
        sink.add(normalized);
    }
};

/** 把一段可能含 CJK 的文本的全拼与首字母分别投进两个桶。 */
const pushPinyin = (fullSink: Set<string>, initialsSink: Set<string>, phrase: string | undefined) => {
    if (!phrase || !CJK.test(phrase)) {
        return;
    }
    const entry = pinyinOf(phrase);
    if (!entry) {
        return;
    }
    pushUnique(fullSink, entry.full);
    pushUnique(initialsSink, entry.initials);
};

const buildEntry = (command: CommandPaletteCommand, locale: string): CommandSearchEntry => {
    const triggers = new Set<string>();
    const titleWords = new Set<string>();
    const initials = new Set<string>();
    const haystackParts: string[] = [];
    const fuzzyParts: string[] = [];

    // 1. 手写同义词。中文同义词是拼音的来源，所以必须活着（见 codemod 的保留规则）。
    command.keywords.forEach(keyword => {
        pushUnique(triggers, keyword);
        pushPinyin(triggers, initials, keyword);
    });

    const englishText = localeText('en', command.id);
    const activeText = locale === 'en' ? undefined : localeText(locale, command.id);
    const chineseText = localeText('zh-CN', command.id);

    // 2. 英文标题恒定入索引：删掉手写英文别名后，中文界面下仍要能用英文搜到。
    if (englishText?.title) {
        pushUnique(triggers, englishText.title);
        splitWords(normalizeSearchText(englishText.title))
            .map(word => word.replace(/[^a-z0-9+.-]/g, ''))
            .filter(word => word.length >= MIN_TITLE_WORD_LENGTH)
            .forEach(word => titleWords.add(word));
        haystackParts.push(englishText.title);
        fuzzyParts.push(englishText.title);
    }
    if (englishText?.description) {
        haystackParts.push(englishText.description);
    }

    // 3. 当前语言的文案。
    if (activeText?.title) {
        pushUnique(triggers, activeText.title);
        haystackParts.push(activeText.title);
        fuzzyParts.push(activeText.title);
    }
    if (activeText?.description) {
        haystackParts.push(activeText.description);
    }

    // 4. 拼音是常开车道，不看当前语言：中文文案的全拼与首字母始终可检索。
    pushPinyin(triggers, initials, chineseText?.title);
    const chineseTitlePinyin = chineseText?.title ? pinyinOf(chineseText.title) : undefined;
    const chineseDescriptionPinyin = chineseText?.description ? pinyinOf(chineseText.description) : undefined;
    if (chineseTitlePinyin) {
        haystackParts.push(chineseTitlePinyin.full);
        fuzzyParts.push(chineseTitlePinyin.full);
    }
    if (chineseDescriptionPinyin) {
        haystackParts.push(chineseDescriptionPinyin.full);
    }

    const byLength = (a: string, b: string) => a.length - b.length || a.localeCompare(b);
    const triggerList = [...triggers].sort(byLength);
    // 已经是全额触发词的，不必再在扣分档里出现一次。
    const titleWordList = [...titleWords].filter(word => !triggers.has(word)).sort(byLength);
    fuzzyParts.push(...triggerList, ...titleWordList);
    const fuzzyTargets = [...new Set(fuzzyParts.map(normalizeSearchText).filter(Boolean))];

    /**
     * 行上那个等宽提示 chip 显示的就是它，语义是「把这段原样打进去就能精确命中这条命令」。
     *
     * 必须先看英文标题，不能从 triggerList 里挑：triggerList 按长度升序排，而生成的拼音缩写
     * 几乎总是最短的那个，于是 chip 会显示 `fmms`、`xuanzekeshihua`、`mg pv` 这种东西。
     * 英文标题本身就是全额触发词（上面 pushUnique 进去的），所以拿它当提示词既是人能读的英文，
     * 也保证打进去精确命中。
     *
     * 退一步才用人写的英文同义词，且**按作者写下的顺序**取——不是按长度。再退一步才是 id。
     * 生成的拼音永远不会进这个字段：这里根本不看 triggerList。
     */
    const englishTitleTerm = normalizeSearchText(englishText?.title ?? '');
    const authoredAsciiKeyword = command.keywords
        .map(keyword => normalizeSearchText(keyword))
        .find(keyword => keyword && /^[a-z0-9][a-z0-9 .+-]*$/.test(keyword));

    return {
        command,
        triggers: triggerList,
        titleWords: titleWordList,
        initials: [...initials].sort(byLength),
        haystack: normalizeSearchText(haystackParts.join(' | ')),
        fuzzyTargets,
        primaryTerm: englishTitleTerm || authoredAsciiKeyword || command.id,
    };
};

/**
 * 条目缓存：语言 -> 命令对象 -> 条目。
 *
 * 一条命令的条目内容**只由它自己的文案推导**——同义词、拼音、本地化标题——和它当下是否可用
 * 毫无关系。而下面那层索引缓存是按「可用命令数组的身份」建的，可用集一变就是新数组，于是
 * 整份索引重建：实测 3.1ms，其中约 93% 花在重新推导那 125 条条目的文本上，而这些条目里
 * 通常有 120 多条一个字都没变。
 *
 * 按命令对象缓存之后，可用集变化只需要重新装配 triggerIndex 和 byId 两张查找表，条目直接复用。
 * 可用集真正会变的时刻是首页 ↔ 播放页切换、设置开关这类导航动作（稳定播放期间不会变），
 * 频率不高，但这份开销本来就是纯浪费。
 *
 * WeakMap 以命令对象为键：注册表是模块常量，条目随进程存活；测试里临时构造的命令数组用完即被回收。
 */
const entryCacheByLocale = new Map<string, WeakMap<CommandPaletteCommand, CommandSearchEntry>>();

const getEntry = (command: CommandPaletteCommand, locale: string): CommandSearchEntry => {
    let byCommand = entryCacheByLocale.get(locale);
    if (!byCommand) {
        byCommand = new WeakMap();
        entryCacheByLocale.set(locale, byCommand);
    }

    const cached = byCommand.get(command);
    if (cached) {
        return cached;
    }

    const built = buildEntry(command, locale);
    byCommand.set(command, built);
    return built;
};

const buildCommandSearchIndex = (commands: CommandPaletteCommand[], locale: string): CommandSearchIndex => {
    const entries = commands.map(command => getEntry(command, locale));
    const triggerIndex = new Map<string, CommandPaletteCommand[]>();
    const byId = new Map<string, CommandSearchEntry>();

    entries.forEach(entry => {
        byId.set(entry.command.id, entry);
        entry.triggers.forEach(trigger => {
            const bucket = triggerIndex.get(trigger);
            if (bucket) {
                bucket.push(entry.command);
                return;
            }
            triggerIndex.set(trigger, [entry.command]);
        });
    });

    return { entries, triggerIndex, byId };
};

/**
 * 索引缓存，照抄 queueEvaluation.ts 的形状：命令数组身份 -> 语言 -> 索引。
 *
 * 失效条件只有两个，都写在键里：命令数组换了实例（WeakMap，随数组一起回收），或界面语言变了
 * （每个语言一个条目，至多三个）。索引不依赖任何其它运行时状态——尤其不依赖 context，
 * 所以换歌、调音量这些让 context 重建的事件不会让它失效（可用集不变时上游会返回同一个数组）。
 *
 * 这一层未命中时的代价由上面的条目缓存兜住：重建的只是两张查找表，不是 125 条条目的文本推导。
 */
const indexCache = new WeakMap<CommandPaletteCommand[], Map<string, CommandSearchIndex>>();

export const getCommandSearchIndex = (
    commands: CommandPaletteCommand[],
    locale = 'en',
): CommandSearchIndex => {
    let byLocale = indexCache.get(commands);
    if (!byLocale) {
        byLocale = new Map();
        indexCache.set(commands, byLocale);
    }

    const cached = byLocale.get(locale);
    if (cached) {
        return cached;
    }

    const built = buildCommandSearchIndex(commands, locale);
    byLocale.set(locale, built);
    return built;
};

/** 空格转 pill 用：给定一个完整触发词，返回声明了它的命令（注册表顺序）。 */
export const findCommandsByTrigger = (
    commands: CommandPaletteCommand[],
    term: string,
    locale = 'en',
): CommandPaletteCommand[] => (
    getCommandSearchIndex(commands, locale).triggerIndex.get(normalizeSearchText(term)) ?? []
);

/** UI 提示词。索引里没有这条命令时回落到 id，绝不返回空串。 */
export const getCommandPrimaryTerm = (
    commands: CommandPaletteCommand[],
    command: CommandPaletteCommand,
    locale = 'en',
): string => getCommandSearchIndex(commands, locale).byId.get(command.id)?.primaryTerm ?? command.id;

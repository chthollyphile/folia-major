import type { Line } from '../../types';

// src/utils/lyrics/staffCredits.ts
// 识别制作人员（staff / credits）块：开头块走带标题容忍的开头检测，其余块由全曲扫描发现。
// 这一层刻意不复用用户的通用过滤正则：通用过滤器是全曲、无条件的用户指令，
// staff 识别则依赖内置词表 + 位置约束，两者语义不同，混用会互相破坏。

// 词表来自实际歌词文件里出现过的署名字段，保持宽松；误伤主要靠下面的
// “冒号 + 冒号前片段很短 + 位置约束”三重约束来压制（位置约束见文件末尾：
// 开头块两行起，不在开头的块三行起）。
const STAFF_ROLE_KEYWORDS = [
    '作词', '作曲', '词', '曲', '编曲', '制作人', '演唱', '吉他', '贝斯', '混音', '母带', '录音',
    '监制', '出品', '策划', '统筹', '设计', '宣传', '运营', '总监', '鸣谢', '工作室', '版权', '发行',
    '艺人统筹', '制作总监', '总顾问', '出品人', '总监制', '战略', '视觉', '资产管理', '总策划',
    '音乐总监', '制作统筹', '音乐版权', '创意顾问', '平面设计', '宣传物料', '黑胶设计', '项目总统筹',
    '艺人协力', '项目协力', '策略行销', '视觉统筹', '媒介', '宣传营销', '联合出品', '协办单位',
    '宣发合作伙伴', '独家短视频平台', '主题歌音乐专辑工作团队', '工作室负责人', '协作', '平面摄影师',
    '海报设计团队', '企划', '和声编写', '画师', '场景画师', 'PV底图', '美工', '题字', '视频',
    '人声后期', 'PV', '封面', '单曲封面', '单曲封面及标准字设计', '单曲封面摄影', '歌词字幕', '歌手', '原唱',
    // 常见补充：和声 / 弦乐 / 键盘 / 鼓 与常见版权缩写
    '和声', '弦乐', '键盘', '鼓', '制作',
    // 英文字段
    'Producer', 'Composer', 'Lyricist', 'Arranger', 'Vocal', 'Guitar', 'Bass',
    'Mixing', 'Mastering', 'Recording', 'Arrangement', 'Lyrics', 'Music',
];

// 无冒号但语义明确的英文署名写法。
const STAFF_BY_PREFIX = /^\s*(?:produced|written|composed|arranged|mixed|mastered|recorded|performed)\s+by\s+\S/i;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 词表必须锚在冒号前那段的开头，且后面只允许跟「另一个词表项」或英文别名，不允许接中文。
// 这条约束是为了挡住 “鼓起勇气：向前走” 这种正文：`鼓` 命中了，但后面是中文续写，
// 说明它是一句话而不是一个字段名。反过来 “录音棚 Recording Studio：…” 这类词表列不全的
// 写法交给下面的结构续接处理，不靠放宽词表来兜。
const KEYWORD_GROUP = `(?:${STAFF_ROLE_KEYWORDS.map(escapeRegExp).join('|')})`;
// 双语字段既可能用空格分开，也可能直接拼接（“歌词字幕Subtitles”）。
const LATIN_ALIAS = `(?:\\s*[A-Za-z][A-Za-z0-9 .&'/-]*)?`;
// 分隔符可有可无，“词曲：X” 和 “混音/母带：X” 都是常见写法。
const BUILT_IN_STAFF_PATTERN =
    `^\\s*[\\[（(【]?\\s*${KEYWORD_GROUP}(?:\\s*[/、&+,，·・和]?\\s*${KEYWORD_GROUP})*${LATIN_ALIAS}\\s*[\\]）)】]?\\s*[:：]\\s*\\S`;

// UI 里展示的自定义示例，不是内置规则本身（内置规则太长，贴出来没有参考价值）。
export const LYRIC_STAFF_PATTERN_EXAMPLE = '^(?:作词|作曲|编曲|制作人|混音|母带)\\s*[:：]';

const builtInStaffRegex = new RegExp(BUILT_IN_STAFF_PATTERN, 'i');

// 无冒号的署名写法（“编曲 某某”“Music by Foo”）：词表项必须是第一个空白前的整段，后面再跟内容。
// 只给“纯音乐提示语旁边的署名”这类整段判定用，不参与开头块的检测，避免正文里“鼓 声音”之类误伤。
const SPACED_STAFF_REGEX = new RegExp(`^\\s*${KEYWORD_GROUP}(?:\\s*[/、&+,，·・和]\\s*${KEYWORD_GROUP})*\\s+\\S`, 'i');

export const isSpacedStaffLine = (line: Line): boolean => SPACED_STAFF_REGEX.test(line.fullText?.trim() || '');

export const getLyricStaffPatternError = (pattern?: string | null): string | null => {
    const normalized = pattern?.trim() || '';
    if (!normalized) {
        return null;
    }

    try {
        new RegExp(normalized, 'i');
        return null;
    } catch (error) {
        return error instanceof Error ? error.message : 'Invalid regular expression';
    }
};

// 空 pattern = 用内置词表；填了就整体替换内置规则（位置约束仍然生效）。
export const createStaffCreditMatcher = (pattern?: string | null): ((line: Line) => boolean) => {
    const normalized = pattern?.trim() || '';
    let custom: RegExp | null = null;

    if (normalized) {
        try {
            custom = new RegExp(normalized, 'i');
        } catch {
            custom = null;
        }
    }

    return (line: Line): boolean => {
        const text = line.fullText?.trim() || '';
        if (!text) {
            return false;
        }

        if (custom) {
            return custom.test(text);
        }

        return builtInStaffRegex.test(text) || STAFF_BY_PREFIX.test(text);
    };
};

export interface StaffCreditBlock {
    /** 词表或结构规则判定为署名的行下标。 */
    staffIndexes: number[];
    /** 块实际占据的全部行下标，含块内和块尾的分隔符行，以及吸收进来的行。 */
    memberIndexes: number[];
    /**
     * 块后第一条真正的歌词行下标；块后面没有歌词时为 null。
     * 检测阶段只在「整首都是署名」时才是 null，吸收阶段还可能因为块吃到数组末尾而取不到。
     */
    firstLyricIndex: number | null;
    /** 块之前被容忍跳过的行数（通常是标题行）。 */
    headerLineCount: number;
    /** 吸收进块的相邻行下标，升序；detectLeadingStaffBlock 恒为空，由 absorbAdjacentLines 填充。 */
    absorbedIndexes: number[];
    /**
     * 该块是否由 detectLeadingStaffBlock 产出（即真的位于歌词开头）。
     * 由检测函数自己设置；策略层用它决定要不要吸收相邻短行 ——
     * 不再自己重新判断一遍位置，那等于把「什么算开头」维护成两份实现。
     */
    fromLeading?: boolean;
}

// 只有符号、标点或装饰字符的短行（"#"、"//"、"---"），署名块之间常用来分隔。
const FILLER_REGEX = /^[^\p{L}\p{N}]+$/u;

// 导出给吸收逻辑复用：块里哪几行算「真正的歌词」必须只有一个判据，
// 两边各判一次迟早会算出不同的 firstLyricIndex。
export const isFillerLine = (line: Line): boolean => {
    const text = line.fullText?.trim() || '';
    return !text || (text.length <= 8 && FILLER_REGEX.test(text));
};

// 词表永远列不全乐器和职位（指挥、绞弦琴、斯瓦希里语顾问……），所以词表只负责起头，
// 之后靠结构继续：紧挨着署名行、且是「字段名＋冒号＋内容」形状的行同样算署名。
//
// 字段名放到 60 字符是因为双语署名很长（"斯瓦希里语顾问 Swahili Language Consultant"、
// "印第安笛 Native American Flute / 排箫 Pan Flute / 盖那笛 Quena"），卡在 24 会把整条链
// 从中间截断。放宽的安全边界不在长度上，而在这条规则必须紧邻词表
// 命中、且块尾至少要连着两条——正文里的 "他说：我爱你" 三条都过不了。
// 排除句读符号：字段名不会带句号问号，带了就是一句话。
const COLON_SHAPED_REGEX = /^[^:：，。！？；…!?]{1,60}[:：]\s*\S/;

export const isColonShaped = (line: Line): boolean => COLON_SHAPED_REGEX.test(line.fullText?.trim() || '');

// 标题行经常占据第 0 行（"歌名 - 歌手"），所以不能直接从 index 0 起要求命中。
const isHeaderLike = (line: Line, meta: { title?: string; artist?: string }): boolean => {
    const text = line.fullText?.trim() || '';
    if (!text) {
        return true;
    }

    if (/\s[-–—]\s/.test(text)) {
        return true;
    }

    return Boolean(
        (meta.title && text.includes(meta.title.trim())) ||
        (meta.artist && text.includes(meta.artist.trim()))
    );
};

export interface DetectStaffBlockOptions {
    /** 允许跳过的开头非 staff 行数上限（标题行等）。 */
    maxHeaderLines?: number;
    /** 一个块至少要有几条署名行才算数；单行块留给它原样显示更安全。 */
    minStaffLines?: number;
    /** 结构续接生效前，至少需要几条词表命中的行来确立「这里是署名块」。 */
    minDictionaryHits?: number;
    /** 块尾靠结构续接进来的行至少要连着几条；孤零零一条更可能是正文。 */
    minTrailingStructuralRun?: number;
    meta?: { title?: string; artist?: string };
}

interface AcceptedLine {
    index: number;
    /** 词表直接命中，而不是靠相邻结构续接进来的。 */
    fromDictionary: boolean;
    /** 这一行之前累积的分隔符行。 */
    leadingFiller: number[];
}

/**
 * 从 `start` 这一条词表命中行起，向后扩展出一个完整署名块。
 * 这是 detectLeadingStaffBlock 与 detectStaffBlocks 共用的唯一扩展逻辑：
 * 结构续接的准入条件、块尾孤立结构行的退回、单行块不处理，全都只在这里判一次。
 */
const expandStaffBlockFrom = (
    lines: Line[],
    start: number,
    isStaffLine: (line: Line) => boolean,
    options: DetectStaffBlockOptions = {}
): StaffCreditBlock | null => {
    const minStaffLines = options.minStaffLines ?? 2;
    const minDictionaryHits = options.minDictionaryHits ?? 2;
    const minTrailingStructuralRun = options.minTrailingStructuralRun ?? 2;

    const accepted: AcceptedLine[] = [];
    let dictionaryHits = 0;
    let pendingFiller: number[] = [];
    let scan = start;

    while (scan < lines.length) {
        const line = lines[scan];

        if (isFillerLine(line)) {
            pendingFiller.push(scan);
            scan += 1;
            continue;
        }

        const fromDictionary = isStaffLine(line);
        const isStructural = dictionaryHits >= minDictionaryHits && isColonShaped(line);

        if (!fromDictionary && !isStructural) {
            break;
        }

        if (fromDictionary) {
            dictionaryHits += 1;
        }

        accepted.push({ index: scan, fromDictionary, leadingFiller: pendingFiller });
        pendingFiller = [];
        scan += 1;
    }

    // 块尾只有一条结构续接进来的行时把它退回去：“他说：我爱你” 和 “指挥 Conductor：X”
    // 在结构上没有区别，区别在于后者总是成片出现，前者是孤立的一句正文。
    let trailingStructural = 0;
    while (
        trailingStructural < accepted.length &&
        !accepted[accepted.length - 1 - trailingStructural].fromDictionary
    ) {
        trailingStructural += 1;
    }

    if (trailingStructural > 0 && trailingStructural < minTrailingStructuralRun) {
        accepted.length -= trailingStructural;
        pendingFiller = [];
    }

    // 单行块一律不处理：孤零零一条署名既不会刷屏，误判的代价却是删掉一句真歌词。
    if (accepted.length < minStaffLines) {
        return null;
    }

    const staffIndexes = accepted.map(entry => entry.index);
    const memberIndexes = accepted.flatMap(entry => [...entry.leadingFiller, entry.index]);

    // 块尾紧跟的分隔符行随块一起处理，否则隐藏署名后会剩下一串孤立的 "#"。
    memberIndexes.push(...pendingFiller);

    const lastMemberIndex = memberIndexes[memberIndexes.length - 1];
    let firstLyricIndex: number | null = null;
    for (let index = lastMemberIndex + 1; index < lines.length; index += 1) {
        if (!isFillerLine(lines[index])) {
            firstLyricIndex = index;
            break;
        }
    }

    return { staffIndexes, memberIndexes, firstLyricIndex, headerLineCount: 0, absorbedIndexes: [] };
};

export const detectLeadingStaffBlock = (
    lines: Line[],
    isStaffLine: (line: Line) => boolean,
    options: DetectStaffBlockOptions = {}
): StaffCreditBlock | null => {
    const maxHeaderLines = options.maxHeaderLines ?? 2;
    const meta = options.meta ?? {};

    let cursor = 0;
    let headerLineCount = 0;

    while (cursor < lines.length && !isStaffLine(lines[cursor])) {
        if (isFillerLine(lines[cursor])) {
            cursor += 1;
            continue;
        }

        if (headerLineCount >= maxHeaderLines || !isHeaderLike(lines[cursor], meta)) {
            return null;
        }

        headerLineCount += 1;
        cursor += 1;
    }

    if (cursor >= lines.length) {
        return null;
    }

    const block = expandStaffBlockFrom(lines, cursor, isStaffLine, options);
    // fromLeading 由检测函数自己带上，而不是交给上层补：直接调用这个函数的代码
    // 也能拿到正确的位置信息，策略层不会因为少一个字段而静默关掉吸收。
    return block ? { ...block, headerLineCount, fromLeading: true } : null;
};

/**
 * 全曲扫描：署名块不只在开头。
 * 有的团体曲一开口就是歌词，把制作名单塞在中间的间奏里；有的干脆放在末尾致谢。
 * 只认开头块的检测会让这些行被当成正文唱出来，所以这里按同样的块规则扫全曲。
 *
 * 与开头版共用 expandStaffBlockFrom，扩展规则一致：词表命中起头、结构续接、
 * 块尾孤立结构行退回。差别有两点：起点可以从任意一行开始；不在开头的块
 * 要求至少三行署名（见 nonLeadingOptions），因为在正文中间误判的代价是删掉歌词。
 */
export const detectStaffBlocks = (
    lines: Line[],
    isStaffLine: (line: Line) => boolean,
    options: DetectStaffBlockOptions = {}
): StaffCreditBlock[] => {
    const blocks: StaffCreditBlock[] = [];

    // 第一步仍走原来的开头检测：这样一来开头块的 headerLineCount、标题容忍、
    // 返回值形状全部按构造保持一致，策略层不需要为「开头」再写第二套判断。
    const leading = detectLeadingStaffBlock(lines, isStaffLine, options);
    if (leading) {
        blocks.push(leading);
    }

    // 第二步从开头块之后继续扫，没有开头块时从第 0 行开始。
    // 起点接在已识别块之后，既不会重复处理同一个块，也不会漏掉紧跟其后的块。
    let cursor = leading
        ? leading.memberIndexes[leading.memberIndexes.length - 1] + 1
        : 0;

    // 不在开头的块要求更多署名行：同一段「字段＋冒号」出现在正文中间时，
    // 误判的代价是删掉正在唱的那句歌词，比漏检一份名单更难被用户接受。
    const nonLeadingOptions: DetectStaffBlockOptions = {
        ...options,
        minStaffLines: Math.max(options.minStaffLines ?? 2, 3),
    };

    while (cursor < lines.length) {
        if (!isStaffLine(lines[cursor])) {
            cursor += 1;
            continue;
        }

        const block = expandStaffBlockFrom(lines, cursor, isStaffLine, nonLeadingOptions);
        if (!block) {
            cursor += 1;
            continue;
        }

        blocks.push(block);
        // 跳过整个块（含块内分隔符），否则块中间的分隔行会被当成新的起点再扫一遍。
        cursor = block.memberIndexes[block.memberIndexes.length - 1] + 1;
    }

    return blocks;
};

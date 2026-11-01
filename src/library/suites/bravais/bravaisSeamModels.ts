import type { BravaisFormState } from './bravaisFormModel';
import type { DailyStyleGroup, DailyStyleSelection } from '../../../types/onlineMusic';

// src/library/suites/bravais/bravaisSeamModels.ts
// B7 集合页挂在层描述上的扩展类型（设计稿 §10.2 / §10.6）：缝里的收藏星标、补页进度、状态行、结果提示、过滤输入位（每面墙都有）、
// 每日推荐的日期步进、「⋯ 更多」与表单态；墙的内容规则（循环周期、有限拼贴的规划条目数、过滤身份）；列表面板与
// 聚焦卡「⋯」要的条目动作。都是已翻译的文案与身份稳定的回调，stage 只读、只调。

/** 缝底状态行的语气：加载、错误、空、过滤无结果的文案与图标都不同（错误与空不能混在一起）。 */
export type BravaisSeamTone = 'loading' | 'error' | 'empty' | 'no-match';

export type BravaisSeamStatus = {
    tone: BravaisSeamTone;
    text: string;
    /** 错误态的「重试」（reload）、过滤无结果的「清除过滤」。 */
    action?: { id: 'retry' | 'clear-filter'; label: string; run: () => void };
};

/** 元数据行的补页进度：进行中只显示已载 / 总数；中断时整行是「续传」按钮。 */
export type BravaisSeamSync = {
    state: 'syncing' | 'interrupted';
    label: string;
    title?: string;
    onResume?: () => void;
};

/** 动作结果（判别式翻译后的文案），在缝底显示几秒；seq 区分两次相同的提示。 */
export type BravaisSeamNotice = { seq: number; text: string; tone: 'info' | 'error' };

export type BravaisSeamSubscribe = {
    subscribed: boolean;
    pending: boolean;
    /** 「收藏歌单 / 取消收藏」等按钮标题（同时是 title 与读屏名）。 */
    title: string;
    onToggle: () => void;
};

/** 每日推荐的日期步进：‹ 日期 ›，再加一个「刷新今天」。 */
export type BravaisSeamDaily = {
    label: string;
    ariaLabel: string;
    disabled: boolean;
    onPrevious?: () => void;
    onNext?: () => void;
    refreshLabel: string;
    onRefresh?: () => void;
    /** 默认推荐 / 风格推荐的切换（#938，平台有风格推荐才给）。 */
    modes?: {
        ariaLabel: string;
        items: readonly { id: 'default' | 'style'; label: string; active: boolean; run: () => void }[];
    };
    /** 正在看风格推荐：日期步进换成选中的风格，点它翻出风格选择。 */
    style?: { label: string; title: string; onOpen: () => void };
};

/**
 * 缝里的过滤输入位（设计稿 §7.6）：每面墙都有。过滤词是这一层的 core 会话 query（query / setQuery 直接读写它），
 * 输入位是缝自己画的（BravaisSeamFilterField）；打字、匹配数、清除都经这里。
 */
export type BravaisSeamFilter = {
    query: string;
    /** 「过滤当前页」占位（同时是输入框的读屏名）。 */
    placeholder: string;
    /** 「匹配 / 总数」（有过滤词时显示）。 */
    matchLabel: string;
    clearLabel: string;
    setQuery: (query: string) => void;
};

/** 「⋯ 更多」里的一项（集合级的低频动作）。 */
export type BravaisSeamMenuItem = {
    id: string;
    label: string;
    disabled?: boolean;
    danger?: boolean;
    run: () => void;
};

/** 表单态里要渲染的东西（状态在 bravaisFormModel，文案与回调由 surface 给）。 */
export type BravaisSeamForm = {
    state: BravaisFormState;
    /** B9：同一种形态的不同表单（首页面板里的建歌单 / 移除所选 / 移除根），挂在 data-bravais-form-id 上。 */
    formId?: string;
    /** 来源动作进行中：提交按钮禁用、显示进行中。 */
    pending: boolean;
    labels: {
        title: string;
        message?: string;
        submit: string;
        cancel: string;
        placeholder?: string;
        createLabel?: string;
        empty?: string;
    };
    /** pick-playlist 的候选（可写的 Navidrome 歌单）。 */
    playlists?: readonly { id: string; name: string }[];
    /**
     * pick-daily-style 的风格分组与正在看的风格。分组还没取到时是空的，显示 labels.empty；没取到（failed）时显示
     * failedLabel 和重试。
     */
    dailyStyle?: {
        groups: readonly DailyStyleGroup[];
        selection: DailyStyleSelection | null;
        failed: boolean;
        failedLabel: string;
        retryLabel: string;
        onRetry: () => void;
    };
    onPickDailyStyle?: (selection: DailyStyleSelection) => void;
    onSubmit: (value: string) => void;
    onPick?: (playlistId: string) => void;
    onStartCreate?: () => void;
    onCancel: () => void;
};

/** 集合层在缝里的那一部分（首页没有）。 */
export type BravaisSeamCollection = {
    /**
     * 集合的描述（歌单简介、专辑介绍……；core 的 resolveCollectionDescription，与网格信息面板同一份），完整信息条里
     * 标题下方、可展开（BravaisSeamBlurb）；没有就不给、不占位。
     */
    description?: string;
    subscribe?: BravaisSeamSubscribe;
    sync?: BravaisSeamSync;
    status?: BravaisSeamStatus;
    notice?: BravaisSeamNotice | null;
    daily?: BravaisSeamDaily;
    menu: readonly BravaisSeamMenuItem[];
    moreLabel: string;
    /** 打开列表面板（只有支持面板的层有）。 */
    listLabel?: string;
    form?: BravaisSeamForm | null;
};

/** 墙的内容规则。 */
export type BravaisLayerWall = {
    /**
     * 无限拼贴的循环周期按多少条算。后台补页期间给上游总数：周期不随每一页变，新页只填进原本空着的 slot（只有新 slot
     * 翻牌）；不给就是条目数。
     */
    periodCount?: number;
    /** 有限拼贴规划世界用的条目数（全量；过滤只改有内容的 rank 数）。 */
    planCount?: number;
    /** 过滤身份（提交了的过滤词）：变了就按「缝的两侧边缘」为起点翻牌。 */
    filterKey?: string;
    /** 首屏加载中：空画框轻微呼吸。 */
    loading?: boolean;
    /**
     * 墙上没有内容时画在墙面上的说明（背景字，BravaisWallHint）：首页的来源因为还没连在线平台、还没导入本地文件夹而空着时
     * 由来源给（bravaisWallHint）；层里有条目时 stage 不画它。
     */
    hint?: BravaisWallHint;
};

/** 空墙上的说明：一行大字标题，下面一段怎么开始的说明（可以没有）。文案都是已翻译的。 */
export type BravaisWallHint = {
    title: string;
    body?: string;
};

/** 列表面板工具行的排序（本地文件夹才有）。 */
export type BravaisListSort = {
    field: string;
    fields: readonly { value: string; label: string }[];
    direction: 'asc' | 'desc';
    directionLabel: string;
    setField: (field: string) => void;
    toggleDirection: () => void;
};

/** 聚焦卡「⋯」里的一项。 */
export type BravaisEntryMenuItem = { id: string; label: string; danger?: boolean };

export type BravaisLayerEntries = {
    /** 有列表面板（歌单 / 专辑 / 文件夹）。 */
    hasPanel: boolean;
    panelTitle: string;
    listCrumb: string;
    sort?: BravaisListSort;
    /** 某一项的「⋯」菜单（空数组就不显示「⋯」）。 */
    menuFor?: (key: string) => readonly BravaisEntryMenuItem[];
    onMenuAction?: (key: string, actionId: string) => void;
    /** Esc 阶梯的「过滤词」一级：有过滤词时先清掉它。 */
    hasQuery: boolean;
    clearQuery?: () => void;
    /** 表单态开着：Esc 先撤销它。 */
    hasForm: boolean;
    cancelForm?: () => void;
    /** B9 首页：管理隐藏视图开着（视图模式，不是导航）：Esc 在面板之后、过滤词之前退出它。 */
    hasViewMode?: boolean;
    exitViewMode?: () => void;
};

/** B8 歌手页在缝里的信息块（设计稿 §10.4「缝承载 ArtistGridView 的信息」）：都是已翻译的展示文字。 */
export type BravaisSeamArtist = {
    coverUrl?: string;
    /** 别名（「又名 …」已拼好）；没有就不显示。 */
    aliases?: string;
    description?: string;
    /** 「N 首 · M 张专辑」。 */
    stats?: string;
    /** 头像的替代文字（歌手名）。 */
    name: string;
};

/**
 * 专辑页的海报（左边钉住的凝彩海报）要的信息：封面、歌手、「专辑 · 年份」标签、元信息行（首数、总时长、流派）。
 * 只有专辑类型的集合有（歌单、每日推荐、文件夹仍是原来的竖缝）；简介在 collection.description 里。
 */
export type BravaisSeamAlbum = {
    coverUrl?: string;
    artists: readonly string[];
    /** 「专辑 · 2024」（没有年份时只有「专辑」）。 */
    kicker: string;
    /** 首数、总时长、流派，已经排好的几段。 */
    facts: readonly string[];
};

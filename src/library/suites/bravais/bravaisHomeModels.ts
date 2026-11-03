import type { LibraryDirectoryVisibilityMode } from '../../core/directory/directory.contract';
import type { BravaisSeamForm, BravaisSeamMenuItem, BravaisSeamNotice } from './bravaisSeamModels';
import type { LibraryHomeSpecialKind } from '../../core/home/homeSpecialCards';

// src/library/suites/bravais/bravaisHomeModels.ts
// B9 首页挂在层描述上的扩展类型（设计稿 §10.5、§5「面板」的目录树）：首页窄缝里的二级切换、工具按钮（搜索、目录、
// 管理隐藏、Navidrome 刷新、app 级入口）、本地「⋯」、管理隐藏视图、扫描进度、全局搜索框、给 B10 账户留的位置；
// 目录树面板（GridMap 的批量模式）的行、全选、底部批量操作与表单态；批量模式下墙上的选择动作。
// 都是已翻译的文案与身份稳定的回调，stage 只读、只调。

/** 缝里的二级切换：本地四行（文件夹 / 专辑 / 歌手 / 歌单）、Navidrome 的 section。切换 = 整面翻牌，不换层。 */
export type BravaisHomeSection = { key: string; label: string; active: boolean };

/**
 * 直达入口（特殊集合：我喜欢的音乐、云盘、私人 FM、每日推荐、全部歌曲、本地「我喜欢」、Navidrome 随机 / 收藏）：
 * 首页窄缝中段底部并排的几列竖排文字（fb11 起；有二级切换时与它之间有分隔线），显示种类的短名（libraryBravaisHome.special.*）。点了直接进入那张集合，与点墙上那张卡同一条打开路径——
 * stage 先在墙上找这一项（屏内离缝最近的一份），找得到就把它记成起点磁贴、走层描述的 onOpenItem；找不到（别的 section、
 * 被过滤掉、在屏外）就调 open，新层以缝为中心排序。只有此刻真有的那几张才有入口（bravaisHomeProjection 的 projectHomeShortcuts）。
 */
export type BravaisHomeShortcut = {
    special: LibraryHomeSpecialKind;
    /** 卡片的全名（进 aria-label / title；缝里显示的是种类的短名）。 */
    label: string;
    /** 这张卡在墙上的条目 key。 */
    itemKey: string;
    /** 点了直接播放、不进新层（私人 FM）：不记起点。 */
    direct: boolean;
    /** 不经墙打开（与点那张卡同一个打开动作：openOnlineCard / openLocalGroup / openNavidromeCard）。 */
    open: () => void;
};

/**
 * 首页窄缝的工具（文案是标题与读屏名）。fb3：底部工具格固定四格——搜索、设置、播放队列、「⋯」；其余（本页签的目录、
 * 管理隐藏、Navidrome 刷新，app 级的回到播放页、舞台播放器）都在「⋯」菜单里（BravaisSeamHomeTools 的 splitHomeTools）。
 */
export type BravaisHomeToolId =
    | 'search'
    | 'filter'
    | 'directory'
    | 'manage-hidden'
    | 'refresh-navidrome'
    | 'refresh-explore'
    | 'queue'
    | 'player'
    | 'stage'
    | 'settings';

export type BravaisHomeTool = {
    id: BravaisHomeToolId;
    label: string;
    /** 开关类（管理隐藏、目录）此刻按下。 */
    pressed?: boolean;
    disabled?: boolean;
    /** 进行中（刷新）：图标转圈。 */
    busy?: boolean;
    /** 工具格里图标旁的短名（舞台入口占一整行时显示；全名仍在 label）。 */
    shortLabel?: string;
    /** 此刻正在用它（舞台：宿主的 stageIsActive；与 grid 一样只标在 data-stage-active 上，不画选中态）。 */
    active?: boolean;
    /** 图标右上角的提示点及其说明（设置：发现新版本）；说明并进 aria-label 与 title。 */
    badge?: string;
    run: () => void;
};

/** 管理隐藏视图（视图模式，不是导航）：缝里「只看隐藏」开关与「完成」。 */
export type BravaisHomeManage = {
    mode: Exclude<LibraryDirectoryVisibilityMode, 'browse'>;
    title: string;
    hiddenOnlyLabel: string;
    doneLabel: string;
    onToggleHiddenOnly: () => void;
    onDone: () => void;
};

/**
 * 全局搜索（设计稿 §10.5「全局搜索的过渡方案」）：缝里 ⌕ 展开成完整宽度的搜索框，提交走宿主的 onSearchCommitted，
 * 跳到 SearchWorkspace——过渡期唯一的离墙路径（计划完成标准 5）。search surface 落地后改成墙内的搜索层。
 * 与当前页过滤明确区分（§7.6）：搜索发 provider 请求、换到搜索结果；过滤不发请求，只收窄当前墙。
 */
export type BravaisHomeSearch = {
    title: string;
    /** 「搜索在线平台」（与过滤输入位的「过滤当前页」区分）。 */
    placeholder: string;
    /** 输入框下面一行说明：搜的是在线平台、结果去搜索页（不是收窄这面墙）。 */
    hint: string;
    submitLabel: string;
    closeLabel: string;
    onSubmit: (query: string) => void;
};

/**
 * 给 B10 账户留的位置：首页在线页签（歌单 / 电台 / 专辑）窄缝里的平台切换。容器是
 * BravaisSeamAccountSlot（`data-bravais-account-slot=<providerId>`），本地 / Navidrome 页签不给。
 * 入口打开共用的登录窗口：换平台、登录、退出都在窗口里。
 */
export type BravaisHomeAccount = {
    providerId: string;
    providerLabel: string;
    /** B10：当前平台的账户状态（昵称 / 未登录 / 无需登录）。fb8 起只进入口的可访问名与 title，不直接显示。 */
    detail: string;
    /**
     * fb8：入口改成 grid 切换器的样子——已登录是头像 + 昵称（没有头像退回平台徽章），无需登录的平台是徽章 + 平台名。
     * 来自当前平台那一行（core 账户视图的 ProviderAccountSummary，与 grid 同一个数据源）。
     */
    nickname: string | null;
    avatarUrl: string | null;
    /**
     * B10：当前平台未登录（墙空着）。窄缝里只显示一个「连接在线平台」入口（connectLabel）；
     * 已登录时是头像 + 昵称的按钮。两种都打开登录窗口。
     */
    guest: boolean;
    /** fb3：未登录时的入口按钮文案（「连接在线平台」）。 */
    connectLabel: string;
    /** 入口按钮的标题（「切换在线音乐平台」）。 */
    toggleLabel: string;
    /** 打开共用的登录窗口，从按下去的那个按钮那一边出来（已登录时开在正在用的平台上）。 */
    onOpen: (pressed: Element | null) => void;
};

/** 首页层在缝里的那一部分（BravaisSeamModel.home）。 */
export type BravaisHomeSeam = {
    /** 二级切换（在线页签没有）。 */
    sections?: readonly BravaisHomeSection[];
    onSelectSection?: (key: string) => void;
    /** 直达入口（没有特殊集合时为空）；放不下时先于二级切换让位，挪进「⋯」菜单（useBravaisSeamTabsFit）。 */
    shortcuts?: readonly BravaisHomeShortcut[];
    /** 直达入口那一列的读屏名（「直达」）。 */
    shortcutsLabel?: string;
    tools: readonly BravaisHomeTool[];
    /** 本地「⋯」：导入文件夹、刷新、导入歌单文件。 */
    menu?: readonly BravaisSeamMenuItem[];
    menuLabel: string;
    /** 管理隐藏视图开着时的开关（浏览时为 null）。 */
    manage?: BravaisHomeManage | null;
    /** 元数据行：扫描进度（本地导入 / 重扫时）。 */
    scan?: string | null;
    search: BravaisHomeSearch;
    /** B10 的账户位（只有在线页签有）。 */
    account?: BravaisHomeAccount | null;
};

/** 目录树面板里的一行（本地文件夹是树；专辑 / 歌手是平铺的条目）。 */
export type BravaisDirectoryRow = {
    /** 行 key（core/directory/directoryTree：条目是 `item:<id>`，树节点是 `node:<id>`）。 */
    key: string;
    label: string;
    detail: string;
    depth: number;
    /** 三态（加「仅本层」）：按子树下显示着的文件夹卡片计算。 */
    selection: 'none' | 'partial' | 'direct' | 'all';
    /** 子树下没有可选的卡片。 */
    selectable: boolean;
    expandable: boolean;
    expanded: boolean;
    /** 树节点的 id（展开 / 收起按它记）；平铺的条目没有。 */
    nodeId?: string;
    ignored: boolean;
    /** 导入根（深度 0、没被忽略）：悬停时有「重新扫描」「移除根」。 */
    rootPath?: string;
    /** 被忽略的文件夹：悬停时有「恢复」。 */
    ignoredPath?: string;
};

export type BravaisDirectoryActionId = 'play' | 'enqueue' | 'create-playlist' | 'remove' | 'clear';

export type BravaisDirectoryPanel = {
    title: string;
    /** 「已选 N / 共 M · K 首」。 */
    summary: string;
    crumb: string;
    rows: readonly BravaisDirectoryRow[];
    emptyLabel: string;
    selectAll: { state: 'none' | 'partial' | 'all'; label: string; toggle: () => void };
    onToggleRow: (rowKey: string) => void;
    onToggleExpanded: (rowKey: string) => void;
    /** 根节点行的悬停操作（文件夹才有）；进行中的根转圈、其余禁用。 */
    roots?: {
        busyPath: string | null;
        disabled: boolean;
        rescanLabel: string;
        removeLabel: string;
        clearIgnoreLabel: string;
        rescan: (rootPath: string) => void;
        remove: (rootPath: string) => void;
        clearIgnore: (path: string) => void;
    };
    actions: readonly { id: BravaisDirectoryActionId; label: string; disabled: boolean; danger?: boolean; run: () => void }[];
    /** 建歌单（输入）、移除所选 / 移除根（确认）：面板底部翻成表单态。 */
    form?: BravaisSeamForm | null;
    notice?: BravaisSeamNotice | null;
};

/** 批量模式（目录树面板开着）下墙与键盘的动作：点卡片只切换选中，绝不进入文件夹。 */
export type BravaisHomeBatch = {
    toggle: (itemKey: string) => void;
    selectAll: () => void;
    play: (enqueue: boolean) => void;
    /** Delete：先翻成确认态。 */
    requestRemove: () => void;
};

/** 首页层的扩展（BravaisLayer.home）。 */
export type BravaisHomeLayer = {
    panel?: BravaisDirectoryPanel | null;
    batch?: BravaisHomeBatch | null;
    /** 歌单类磁贴右上角的眼睛按钮（directory-toggle-hidden）。 */
    onToggleHidden?: (itemKey: string) => void;
    /** F6 / Shift+F6：切到下一个 / 上一个可用页签（没得切时返回 false）。 */
    cycleTab?: (delta: 1 | -1) => boolean;
};

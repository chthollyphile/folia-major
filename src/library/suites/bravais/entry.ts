import React from 'react';
import type { LibraryActionId, LibraryArtistActionId, LibraryHomeActionId, LibrarySuiteManifest } from '../../core/suite/suite.contract';
import type { LibraryNavigationContext } from '../../core/suite/suite.contract';

// src/library/suites/bravais/entry.ts
// bravais suite（library v2 的正式新 UI，设计稿不在仓库里）：用户始终站在一面墙前，导航与筛选都是
// 给墙上的位置翻牌换内容，页面信息与操作放在墙面裂开的一道缝里。画面全在 stage（BravaisStage）里，它横跨首页与集合层；
// 各 surface 只把 core 的数据投影成层描述交给 suite 内的 stage store（bravaisStageStore），自己不画画面。
//
// B6（骨架）只实现首页（「歌单」页签）与集合页的浏览，按「声明以 entry 为准」只声明做到了的 surface 与动作：
// 歌手页与账户没声明，照常回退 grid；首页的目录 / 导入等动作、集合页的过滤与变更动作在 B7–B10 补齐。
// B8 起歌手页也由 bravais 渲染（10 个动作）；B8 当时账户仍回退 grid，B10 起账户也由 bravais 渲染（见下一行）。
// B9 起首页五个页签都铺墙，声明 grid 的全部 15 个首页动作（见 HOME_ACTIONS）。
// B10 起账户也由 bravais 渲染（登录与确认在缝里，见 ACCOUNT_ACTIONS），不再回退 grid 的登录弹窗。
// 本文件只能静态 import react（test/unit/library/suiteEntries.test.ts）：组件与 stage 一律 React.lazy，
// 没选 bravais 的人不加载它的任何 chunk。

/**
 * 每一层布局记忆（相机、缝的锚点、起点 slot）在 sessionStorage 里的键前缀，后接会话键。
 * 定义在这里是因为 layout.forget 就在这里按它删记录（entry 不能静态 import bravaisLayoutMemory）。
 */
export const BRAVAIS_LAYOUT_STORAGE_PREFIX = 'folia_bravais_layout:v1:';

/**
 * B11 转场钩子的接线：manifest 的 transitions 声明在这里，实现却在 stage 的 chunk 里（本文件只能静态 import react）。
 * 那边的模块加载后经 installBravaisTransitionHook 装上；没选过 bravais 的人从不加载那个 chunk，钩子就是空操作——
 * 宿主切 suite 时对每一套都调 reset，不能为它去加载 bravais。
 */
export type BravaisTransitionHooks = {
    beforePush: (context: LibraryNavigationContext) => void;
    reset: () => void;
};

const transitionHooks: { [Name in keyof BravaisTransitionHooks]: BravaisTransitionHooks[Name] | null } = {
    beforePush: null,
    reset: null,
};

/** 装上一个钩子，返回卸下的函数（只卸自己装的那一个）。 */
export const installBravaisTransitionHook = <Name extends keyof BravaisTransitionHooks>(
    name: Name,
    hook: BravaisTransitionHooks[Name],
): (() => void) => {
    transitionHooks[name] = hook;
    return () => {
        if (transitionHooks[name] === hook) transitionHooks[name] = null;
    };
};

const BravaisStage = React.lazy(() => import('./BravaisStage'));
const BravaisHome = React.lazy(() => import('./BravaisHome'));
const BravaisCollection = React.lazy(() => import('./BravaisCollection'));
const BravaisArtist = React.lazy(() => import('./BravaisArtist'));

// 集合页（B7 齐了 grid 的 23 个，入口见设计稿 §10.2）：聚焦卡主按钮（播放 / 入队）、文字链接（专辑 / 歌手）与「⋯」
// （移出 / 不喜欢、手动匹配、加入歌单）；缝里的播放全部 / 入队、过滤输入位（缝自己的，墙上直接打字）、收藏星标、元数据行的续传、
// 每日推荐的日期步进、「列表」（面板工具行里的排序）与「⋯ 更多」（重新拉取、改名、删除、重扫、导出、实体信息、
// 整理歌曲信息、加入歌单）；改名 / 删除确认 / 加入歌单选择与新建是缝的表单态。grid 的三个局部动作不声明：
// 信息面板 → 缝等级、曲目侧栏 → 列表面板（外观动作 list）、编辑模式 → 改名表单态。
const COLLECTION_ACTIONS: readonly LibraryActionId[] = [
    'play',
    'enqueue',
    'play-scope',
    'enqueue-scope',
    // 歌曲磁贴与聚焦卡右上角悬浮的「加入速记簿」「收藏到歌单」（应用的歌单选择器，含「我喜欢」）；缝「⋯ 更多」的
    // 「全部加入速记簿」（命令面板的 collect-filtered）。
    'collect',
    'collect-scope',
    'save-to-playlist',
    'filter',
    'sort',
    'reload',
    'resume-sync',
    'remove-entry',
    'subscribe',
    'rename',
    'delete-collection',
    'resync-folder',
    'resync-all-folders',
    'export-playlist',
    'edit-entity',
    // 「⋯ 更多」里的「设置封面」：本地文件夹 / 专辑 / 歌单的自定义封面（宿主的封面对话框）。
    'set-cover',
    'organize-song-info',
    'match-song',
    'add-to-playlist',
    'create-playlist',
    'daily-date',
    'open-album',
    'open-artist',
];

// 首页（B9，设计稿 §10.5）：15 个动作全部声明。
// - 当前页过滤（directory-filter，设计稿 §7.6）：每个页签的墙上直接打字，进首页窄缝里的输入位；目录树面板里是同一个。
// - 目录树面板（本地窄缝的 ▤，面板 = 批量模式）：卡片 / 树节点的选择与全选、
//   底部的播放 / 入队 / 建歌单（表单态）/ 移除所选（确认态）；根节点行悬停的重新扫描、移除根（确认态）、恢复忽略。
// - 管理隐藏：缝里常驻的「管理隐藏」按钮进入的视图（只看隐藏）；歌单类磁贴右上角的眼睛按钮切换隐藏。
// - 本地窄缝「⋯」的导入文件夹 / 刷新 / 导入歌单文件；Navidrome 窄缝的刷新。
// 在线账户：首页在线页签窄缝里只有一个账户入口，点了打开共用的登录窗口（src/components/login）；换平台、登录、
// 登出、选方式、失败详情与本地服务重启都在窗口里。bravais 不声明 account surface：切换确认
// 整体回退到 grid 的确认框（registry 的回退规则）。
const HOME_ACTIONS: readonly LibraryHomeActionId[] = [
    'directory-filter',
    'directory-select',
    'directory-play-selection',
    'directory-enqueue-selection',
    'directory-create-playlist',
    'directory-remove-selection',
    'directory-rescan-root',
    'directory-remove-root',
    'directory-clear-ignore',
    'directory-manage-hidden',
    'directory-toggle-hidden',
    'home-import-folder',
    'home-refresh-folders',
    'home-import-playlist',
    'home-refresh-navidrome',
];

// 歌手页（B8，入口见设计稿 §10.4，与 grid 的歌手页声明同一组 10 个）：热门歌曲磁贴 → 聚焦卡（播放 / 入队，其他歌手与
// 专辑的链接）；单击专辑磁贴进入专辑；缝里的播放热门 / 加入热门歌曲、过滤位（只筛专辑名）、错误态的「重试」与专辑分页中断时
// 元数据行的「续页」、「⋯ 更多」里的重新拉取与本地歌手的实体编辑（宿主对话框）。
const ARTIST_ACTIONS: readonly LibraryArtistActionId[] = [
    'play',
    'enqueue',
    'play-scope',
    'enqueue-scope',
    'filter',
    'reload',
    'resume-sync',
    'edit-entity',
    'open-album',
    'open-artist',
];

// 外观动作（suite-chrome，只出现在命令面板里）：缝的三级开口、在这里裂开缝、定位正在播放。
// 正式文案在三份 locale 的 commandPalette.commands.bravais-<id>；这里的 title / description 只是缺译时的英文回退。
// 关键词只写英文与中文（拼音由构建期插件从这里的中文生成）。执行键：只有「定位正在播放」给 `c`（与 Lattice 的
// 「聚焦当前歌曲」同键，两者的作用范围不会同时成立）；`l` 已被全局「循环播放」占用，B6 没有「打开列表」。
const CHROME_ACTIONS: LibrarySuiteManifest['chromeActions'] = [
    {
        id: 'seam-full',
        title: 'Expand the info strip',
        description: 'Open the seam on the library wall to its full info strip',
        keywords: ['seam', 'wall strip', '展开信息条', '缝'],
    },
    {
        id: 'seam-spine',
        title: 'Collapse the info strip',
        description: 'Narrow the seam on the library wall to a book spine',
        keywords: ['spine', 'narrow seam', '书脊', '收起信息条'],
    },
    {
        id: 'seam-hide',
        title: 'Fold the info strip',
        description: 'Close the seam and keep only a tab at the screen edge',
        keywords: ['fold seam', 'hide strip', '折叠信息条', '隐藏缝'],
    },
    {
        id: 'seam-here',
        title: 'Split the wall here',
        description: 'Open a new seam in the current view after the old one slid off screen',
        keywords: ['reopen seam', 'split', '裂开', '重新裂开缝'],
    },
    // B7：打开列表面板（grid 的 toggle-track-list 的对应）。不给执行键：`l` 被全局循环播放占用。
    {
        id: 'list',
        title: 'Open the track list',
        description: "Widen the seam on the library wall into this collection's track list",
        keywords: ['track list', 'list panel', '歌曲列表', '打开列表'],
    },
    // B9：打开目录树（首页「本地」有批量的那几行；面板 = 批量模式）。同样不给执行键。
    {
        id: 'directory',
        title: 'Open the directory',
        description: 'Widen the seam on the library home into the local folder tree and select in batches',
        keywords: ['folder tree', 'batch select', '目录树', '批量选择'],
    },
    {
        id: 'locate-playing',
        title: 'Locate the playing song',
        description: 'Move the wall focus to the song that is playing now',
        keywords: ['now playing', 'current song', '定位正在播放', '当前歌曲'],
        executeShortcut: 'c',
    },
    // 透光（B6b③，设计稿 §11）：循环三档（执行键 `p`），部分透明时每块多开 / 少开一个窗（不给执行键）。
    // 与设置页、命令面板里的两个 picker 写同一个 app 层偏好（useLibraryWallLookStore）。
    {
        id: 'wall-look',
        title: 'Cycle wall see-through',
        description: 'Switch the library wall between solid, partly see-through and see-through',
        keywords: ['see-through', 'transparency', 'windows', '透光', '透明', '实色'],
        executeShortcut: 'p',
    },
    {
        id: 'more-windows',
        title: 'Open more wall windows',
        description: 'Add one see-through window to every block of the library wall',
        keywords: ['more windows', 'window count', '多开窗', '窗数'],
    },
    {
        id: 'fewer-windows',
        title: 'Open fewer wall windows',
        description: 'Close one see-through window in every block of the library wall',
        keywords: ['fewer windows', 'window count', '少开窗', '窗数'],
    },
];

const bravais: LibrarySuiteManifest = {
    id: 'bravais',
    labelKey: 'libraryBravais.suiteName',
    stage: BravaisStage,
    // 进 / 出 Lattice 走翻牌交接（设计稿 §7「进入队列」；stage 里的 useBravaisWallHandoff）。
    stageWallHandoff: true,
    surfaces: {
        home: { component: BravaisHome, actions: HOME_ACTIONS },
        collection: { component: BravaisCollection, actions: COLLECTION_ACTIONS },
        artist: { component: BravaisArtist, actions: ARTIST_ACTIONS },
    },
    chromeActions: CHROME_ACTIONS,
    // B11（设计稿 §10.8）：换层的翻牌由 stage 观察导航深度驱动（应用内返回、浏览器后退、N1 折回、面包屑跳层都是一次
    // 深度变化，各翻一次），所以不声明 beforeBack，也不声明 Overlay 与 backdrop（「降低动态效果」由 stage 自己解析，
    // 见 bravaisMotion）。beforePush 只在宿主真的压栈时跑：没经过墙上磁贴的打开（命令面板对焦点那一项的 open-album /
    // open-artist）用键盘焦点所在的 slot 当起点磁贴；reset 在切 suite 时丢掉还没用掉的起点。
    transitions: {
        beforePush: context => transitionHooks.beforePush?.(context),
        reset: () => transitionHooks.reset?.(),
    },
    layout: {
        forget: sessionKey => {
            try {
                sessionStorage.removeItem(BRAVAIS_LAYOUT_STORAGE_PREFIX + sessionKey);
            } catch {
                // sessionStorage 不可用：本来也没有记录。
            }
        },
    },
};

export default bravais;

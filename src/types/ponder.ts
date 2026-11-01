// src/types/ponder.ts
// 「思索」教程系统的跨层合同：目标注册、场景 DSL、编译产物。
//
// 放在 types 而不是 components/ponder 下，是因为 store（离散会话状态）、utils（锚点解析与
// 时间线编译）、hooks（悬停与长按状态机）和组件层都要引用同一批类型；任何一边单独持有都会
// 让另外三边反向依赖它。
//
// 这里只有类型和字面量常量，没有 DOM、没有 animejs —— vitest 跑在 node 环境（vitest.config.ts:17），
// 依赖这份合同的纯函数必须能在没有 window 的情况下被单测。

/** 可教学区域。新增一个 target 要同时在这里登记 id，注册表才认。 */
/**
 * 可教学区域，按**用户会单独指着问的那个东西**划分。
 *
 * 大多数时候那就是一个组件整体：用户对着看得见的一整条控制条大致比划着按 G，
 * 指望他先精确命中右边某个 20px 的槽位再按，等于这条教程没人看得到 ——
 * 所以底部控制条是一个目标、里面分章节，而不是「高度」「槽位」「随机」「音量」四个。
 *
 * 但组件本身就是一排选项卡、或者角上摆着几颗互不相干的按钮时，那一格、那一颗才是
 * 被指的东西。控制面板的四个标签页和封面四角那四颗隐藏按钮属于这一类：合进 side-panel
 * 的话，想问「队列页是什么」得先看完从封面讲起的六章。判据是「指针停在那儿时，
 * 用户想知道的是什么」，不是 DOM 的粗细。
 */
export type PonderTargetId =
    | 'panel-slide'
    | 'player-bar'
    | 'grid-page'
    | 'grid-view-page'
    | 'local-grid-map-page'
    | 'player-page'
    | 'lattice-page'
    | 'help-page'
    | 'settings-page'
    | 'command-palette'
    | 'side-panel'
    // 控制面板里各自成立的那几处：封面四角那四颗隐藏按钮，以及四个标签页。
    // 它们是「按组件划分」的下一层 —— 一格标签、一颗角上的按钮本身就是用户会单独
    // 指着问的那个东西，合进 side-panel 的话，问一页要先看完六章。
    | 'panel-cover-actions'
    | 'panel-cover-tab'
    | 'panel-source-tab'
    | 'panel-controls-tab'
    | 'panel-queue-tab'
    | 'panel-account-tab'
    | 'lattice-chrome'
    | 'lyrics-animation-settings'
    | 'theme-settings'
    | 'grid3d-card-style'
    | 'grid-view-card-settings'
    | 'lattice-style-settings'
    | 'grid-action-button'
    | 'grid-view-edit-mode'
    | 'local-folder-actions'
    | 'local-metadata-match'
    | 'local-track-sorting'
    | 'local-grid-controls'
    | 'online-collection-actions'
    | 'local-grid-map-directory-tree'
    // 从 help-page 拆出来的详细教程：入门页只留四章概览，细节各自成目标。
    | 'ponder-basics'
    | 'folia-transport'
    | 'folia-shortcuts'
    | 'folia-desktop'
    | 'queue-command-surface'
    | 'transition-settings'
    | 'local-library-watch'
    | 'queue-settings'
    | 'lyrics-settings'
    | 'grid-palette-hotkey'
    // 设置里剩下那几处「界面上没写、但改错了会一直别扭」的：修饰键固定成 Alt 的自定义
    // 快捷键、和最近用过分属两套机制的固定命令、与来源页同一个值的音频增益，以及
    // 只备份视觉那一套、却叫「备份与导入」的那一组。
    //
    // 后面三个是藏在对话框和整屏编辑器里的：均衡器拖一根推子就会静默换槽并覆写、
    // 调参台预览上那三块看不见的热区、以及 Theme Park 整屏编辑器本身。
    | 'custom-shortcut-settings'
    | 'pinned-commands'
    | 'replay-gain-settings'
    | 'import-export-settings'
    | 'audio-equalizer'
    | 'vis-playground'
    | 'theme-park'
    | 'lyric-style'
    // 歌词导出：命令面板里那一页批量导出。面板上那颗单曲导出按钮归 panel-source-tab 讲。
    | 'lyric-export'
    // 随机播放在哪：没有随机模式，只有打乱队列，以及它的四个入口。连点循环按钮的提示送人来这里。
    | 'queue-shuffle'
    // bravais 资料库：墙（页面教程，bravais 的首页 / 集合 / 歌手页都映射到它；平移、翻牌、磁贴、聚焦卡、透光）与中间那道缝（信息条）各是一篇，互为 related。
    | 'bravais-wall'
    | 'bravais-seam'
    // 登录：主页的登录按钮、右下角那一枚，和它们打开的登录窗口。
    | 'sign-in'
    // 匹配歌词的窗口：面板来源页的「在线匹配」打开它。
    | 'lyric-match'
    // 速记簿：左缘滑出的歌曲暂存区（收进来、按来源分组处理、展开成画布）。
    | 'scratchpad';

/**
 * 导航页把目标按这个分组。
 *
 * 存在的理由是入门教程不能无限长：总览只说一段，剩下的靠导航页把人送到具体那一条。
 * 分组写在目标自己身上而不是导航页里维护一张表 —— 表和注册表必然走散，
 * 新加的目标会静悄悄地不出现在导航页上。
 */
export type PonderTargetCategory = 'basics' | 'playback' | 'browsing' | 'appearance' | 'desktop';

export const PONDER_TARGET_CATEGORIES: readonly PonderTargetCategory[] = [
    'basics', 'playback', 'browsing', 'appearance', 'desktop',
];

/** 悬停提示的三档可见性。 */
export type PonderHintVisibility = 'always' | 'unseen' | 'off';

export const PONDER_HINT_VISIBILITY_VALUES: readonly PonderHintVisibility[] = ['always', 'unseen', 'off'];

export const isPonderHintVisibility = (value: unknown): value is PonderHintVisibility => (
    typeof value === 'string' && (PONDER_HINT_VISIBILITY_VALUES as readonly string[]).includes(value)
);

/**
 * 视口坐标下的矩形，单位 px。骨架层画的每个框最终都是它。
 *
 * radius 是从真实元素上量来的 border-radius 原样字符串：圆形按钮要得到圆形骨架，
 * 靠的是量而不是靠场景脚本去描述形状 —— 描述一遍就会和真实组件走散。
 */
export type PonderRect = {
    left: number;
    top: number;
    width: number;
    height: number;
    radius?: string;
};

/** 按视口比例表达的矩形，给进入时不在 DOM 里的元素用。anchorX/anchorY 决定 left/top 是边还是中心。 */
export type PonderViewportRect = {
    left: number;
    top: number;
    width: number;
    height: number;
    /**
     * 高宽比（height ÷ width，像素）。给出它时高度由宽度算，`height` 只作兜底。
     *
     * 存在的理由：宽按视口宽算、高按视口高算，同一个 surface 的形状就随窗口比例变。
     * 里面还摆着按**宽度**定尺寸的方块（控制面板顶上那张正方形封面）而其余各块按
     * **高度**的百分比定位时，这两套单位会在宽屏上错开 —— 16:9 下封面会直接压到
     * 标签排上。锁死比例之后，一份百分比在任何窗口下都成立。
     */
    aspect?: number;
    anchorX?: 'left' | 'center' | 'right';
    anchorY?: 'top' | 'center' | 'bottom';
};

/** 锚在某个骨架框上的一个点：归一化坐标 + 像素偏移。光标和按键提示的落点都用它。 */
export type PonderAnchorPoint = {
    anchor: string;
    /** 0..1，默认 0.5 */
    x?: number;
    /** 0..1，默认 0.5 */
    y?: number;
    offset?: { x?: number; y?: number };
};

/**
 * 一个骨架框的来源。
 *
 * `dom` 是「按真实 DOM 矩形生成骨架」那条决定的落点：进入瞬间量一次，之后不再订阅。
 * `derived` 给那些量不到、但几何完全由另一个框确定的东西（滑轨宽度写死、判定线在按钮左 36px）；
 * 推导比查询稳，还不受目标元素显隐状态影响。
 * `synthetic` 给进入时根本不在场的元素（尚未打开的命令面板、音量面板）。
 */
/**
 * 骨架框画成什么样。纯色块读起来像色块，不像界面 —— 角色决定它的边框、内部纹理和标签位置。
 */
export type PonderAnchorRole =
    /** 一个面板/容器，画成带标题栏和几行占位内容的面。 */
    | 'surface'
    /** 一个可按的控件，画成圆角实心小块。 */
    | 'control'
    /** 一条轨道/滑槽，画成细长的胶囊。 */
    | 'rail'
    /** 一条判定线/刻度，画成一根竖线，不画框。 */
    | 'marker'
    /**
     * 只有几何、不画任何东西的区域。
     *
     * synthetic surface 已经把真实界面的轮廓画出来了，再给里面每个区域套一个描边框，
     * 就是把同一个东西画两遍 —— 框和标签互相压着，反而看不出界面长什么样。
     * region 只提供高亮填充和指向线的落点，框本身不可见。
     */
    | 'region';

/** surface 骨架里面的界面类型；只画结构，不复制真实界面的业务状态。 */
export type PonderSurfaceKind =
    /**
     * 只有面板外框，里面什么都不画。模组的面板默认用它：模组画不出自己界面的骨架，
     * 与其套一个像命令面板的占位，不如留白，让骨架框和字幕去讲。
     */
    | 'plain'
    | 'palette'
    | 'picker'
    | 'queue'
    | 'volume'
    | 'grid-page'
    | 'grid-view-page'
    | 'local-grid-map'
    | 'player-page'
    | 'lattice-page'
    | 'settings-page'
    | 'player-bar'
    /** 入门教程的示意图：思索自己是怎么用的，不对应任何一个真实页面。 */
    | 'ponder-onboarding'
    | 'bottom-ui-settings'
    | 'side-panel'
    | 'lattice-chrome'
    | 'lyrics-animation-settings'
    | 'theme-settings'
    | 'grid3d-card-style'
    | 'grid-view-card-settings'
    | 'lattice-style-settings'
    | 'grid-action-button'
    | 'grid-view-cards'
    | 'local-folder-actions'
    | 'local-track-list'
    | 'local-grid-controls'
    | 'online-collection-actions'
    | 'desktop-features'
    | 'queue-command'
    | 'transition-settings'
    | 'library-watch-settings'
    | 'queue-settings'
    | 'lyrics-source-settings'
    | 'grid-hotkey-settings'
    | 'custom-shortcut-settings'
    | 'pinned-commands-settings'
    | 'replay-gain-settings'
    | 'import-export-settings'
    | 'audio-equalizer'
    | 'vis-playground'
    | 'theme-park'
    /** 歌词样式：调参台的布局，预览和右栏各自可换，背景和歌词也各自可换。 */
    | 'lyric-style'
    /** 命令面板里的批量导出歌词页：输入行、三节多选卡（范围 / 格式 / 命名），底边一条操作栏。 */
    | 'lyric-export'
    /** bravais 的墙：缝在正中、左右两半的磁贴墙，以及平移、翻牌、聚焦卡、透光、进 Lattice 的结果层。 */
    | 'bravais-wall'
    /** bravais 首页：墙中间 120px 的窄缝（页签、二级切换、直达、账户、工具格）。 */
    | 'bravais-seam-home'
    /** bravais 集合 / 歌手页：300px 的完整信息条，以及书脊、折叠、列表面板几档。 */
    | 'bravais-seam-strip'
    /** 没有人登录时的主页，和盖在它上面的登录窗口。 */
    | 'sign-in'
    /** 匹配歌词的窗口：左边来源、搜索和结果，右边选中的那一条和它的歌词。 */
    | 'lyric-match'
    /** 速记簿：一面资料库磁贴墙和左缘的把手，以及滑出的抽屉、展开成的画布。 */
    | 'scratchpad';

/**
 * 以来源矩形为 0..1 坐标系的相对矩形。
 *
 * 语义刻意和 CSS 的 inset + aspect-square 对齐：合成界面用 relativeRectStyle 把同一条记录
 * 翻成定位样式，target 用它声明锚点。两边各写一遍百分比必然走散，高亮就会落在真实元素旁边。
 *
 * 水平方向给 left/right/width 中的两个，垂直方向给 top/bottom/height 中的两个；
 * square 表示高度按宽度推成像素意义上的正方形，对应 CSS `aspect-square`。
 */
export type PonderRelativeRect = {
    left?: number;
    right?: number;
    top?: number;
    bottom?: number;
    width?: number;
    height?: number;
    square?: boolean;
    /**
     * 高度 = 像素宽度 × aspect，对应 CSS `aspect-ratio: 1 / aspect`。square 是 aspect 为 1 的特例。
     * 和一个 square 元素同高时用它：height 是按来源矩形的高度算的，宽高比一变两者就对不齐。
     */
    aspect?: number;
};

type PonderAnchorCommon = {
    /** 骨架上给这个框标的名字。不给就不标。 */
    labelKey?: string;
    /** 默认 'control'。 */
    role?: PonderAnchorRole;
    /**
     * 标签放哪。默认 surface 放框内左上，其余放框上方。
     * 互相嵌套的框（按钮和包着它的滑轨）必须显式错开，否则两个标签会叠在一起。
     */
    labelPlacement?: 'above' | 'below' | 'inside';
    /** role=surface 时用更接近真实 DOM 的骨架，避免所有面板都长成同一块占位文本。 */
    surfaceKind?: PonderSurfaceKind;
    /**
     * 这个框一开始不在场，要等一个 reveal 步骤把它放出来。
     *
     * 命令面板、设置里的选择器、音量面板这些都是某个动作的**结果**：一进场就摆在屏幕上，
     * 字幕再说「按 S 打开命令面板」就成了旁白，演的和说的对不上。
     */
    startsHidden?: boolean;
    /**
     * 骨架框的圆角，原样交给 CSS。
     *
     * dom 锚点是从真实元素上量的，synthetic 锚点没有可量的对象 —— 底部控制条是一条胶囊，
     * 不写出来就会被画成一个圆角矩形。
     */
    radius?: string;
};

export type PonderAnchorSource = PonderAnchorCommon & (
    | { kind: 'dom'; selector: string; fallback?: PonderViewportRect }
    | { kind: 'synthetic'; rect: PonderViewportRect }
    | {
          kind: 'relative';
          from: string;
          /** 以来源矩形为 0..1 坐标系；页面 surface 内的真实区域都用它标注。 */
          rect: PonderRelativeRect;
      }
    | {
          kind: 'derived';
          from: string;
          /** 四边各自外扩的 px，可为负。 */
          expand?: { left?: number; right?: number; top?: number; bottom?: number };
          /** 给了 at + size 就只取 from 上的一个点，再按 size 画框。 */
          at?: PonderAnchorPoint;
          size?: { width: number; height: number };
      }
);

type PonderStepBase = {
    id: string;
    /** true = 与上一步同时开始，而不是接在它后面。字幕配动作全靠它。 */
    withPrevious?: boolean;
    /** true = 这一步的起点是一个关键帧，进度条上画刻度，←/→ 跳到它。 */
    keyframe?: boolean;
};

/**
 * 场景原语。
 *
 * `drag` 和 `highlight` 是在 caption / cursor / keypress / pausePoint 四个之外加的：
 * 面板滑动和底栏拖高两个场景的主体就是拖，而 `highlight` 是「这个框现在重要」的唯一表达方式 ——
 * 骨架框本身是静态的，没有它就只有光标在动、看不出在动谁。
 */
export type PonderStep =
    | (PonderStepBase & {
          kind: 'caption';
          textKey: string;
          durationMs: number;
          /**
           * 这段字幕在讲哪个锚点：聚焦框落到它身上，并带上它的名字。
           * 字幕固定在画面下方，没有它，一句话和画面上五个框之间就没有任何对应关系。
           * 框圈的是整个锚点。
           */
          pointTo?: { anchor: string };
      })
    | (PonderStepBase & {
          kind: 'cursor';
          to: PonderAnchorPoint;
          from?: PonderAnchorPoint;
          durationMs: number;
          ease?: string;
          press?: 'down' | 'up' | 'tap';
      })
    | (PonderStepBase & { kind: 'drag'; from: PonderAnchorPoint; to: PonderAnchorPoint; durationMs: number; ease?: string })
    | (PonderStepBase & { kind: 'keypress'; keys: string[]; at: PonderAnchorPoint | 'bottom'; durationMs: number })
    | (PonderStepBase & { kind: 'highlight'; anchor: string; intensity?: [number, number]; durationMs: number })
    /**
     * 把一个 startsHidden 的框放出来。
     *
     * 和 surfaceState 是一对：surfaceState 换的是某个 surface **内部**的那一屏，
     * reveal 管的是这个框本身在不在场。按下 S 之后命令面板才长出来，靠的是它。
     */
    | (PonderStepBase & {
          kind: 'reveal';
          anchor: string;
          durationMs: number;
          transition?: 'fade' | 'slide-up' | 'zoom';
      })
    /**
     * 把 synthetic surface 切到一次操作之后的结果层。
     *
     * 页面教程不能只演「光标按了哪里」；打开集合、展开海报、唤出工具面板这些结果
     * 才是操作的含义。结果层预先渲染，时间线只写 opacity/transform，不触发 React render。
     */
    | (PonderStepBase & {
          kind: 'surfaceState';
          anchor: string;
          state: string;
          durationMs: number;
          transition?: 'fade' | 'slide-up' | 'zoom';
      })
    /** pausePoint：短暂停留后自动继续。必然是关键帧，不需要显式写 keyframe。 */
    | (PonderStepBase & { kind: 'pause'; dwellMs?: number });

/** pausePoint 的默认停留时长。留给读字幕，短了会逼着人倒回去重看。 */
export const PONDER_DEFAULT_DWELL_MS = 1400;

/**
 * 一章播完之后自动进入下一章的读条时长。
 *
 * 教程是连着看的，每章结束都要伸手点一下「下一章」，连贯感就断在每一章的末尾。
 * 读条是明示的：条走完之前暂停、把指针移到那颗按钮上、或者按任意键，都会把它取消，
 * 所以「自动」不会把正在读字幕的人推走。
 */
export const PONDER_AUTO_ADVANCE_MS = 2000;

/**
 * 高亮填充的最大不透明度。
 *
 * DSL 里的 intensity 是 0..1 的「有多亮」，落到画面上要乘这个系数：直接用 1.0 画主题色
 * 会得到一整块纯色，骨架就不再是骨架了。
 */
export const PONDER_HIGHLIGHT_MAX_OPACITY = 0.3;

/**
 * 一章可以附带的「直接去那儿」入口。
 *
 * 教程讲完某个设置藏在哪之后，让人自己再翻一遍设置面板是没必要的损耗 ——
 * 尤其这些设置本来就以难找著称，正是它们被收进教程的原因。
 *
 * anchorId 故意只声明成 string：types 层不该反向依赖 components 层的
 * settingsAnchorModel。写错了由 ponderSceneAction 的单测挡住，它会去核对
 * SETTINGS_ANCHOR_DEFINITIONS 里确实有这个锚点。
 */
export type PonderSceneAction =
    | {
          kind: 'openSettings';
          anchorId: string;
          labelKey: string;
      }
    /**
     * 打开歌词动画调参台并停在某一页。
     *
     * 调参台不是 SettingsAnchor —— 它是设置里的一个整屏子视图，四页由 section 选，
     * 所以不能走 openSettings 的锚点。section 同样只声明成 string，理由同上；
     * ponderRegistry 的单测核对它是调参台真实存在的一页。
     */
    | {
          kind: 'openVisualizerSettings';
          section: string;
          labelKey: string;
      }
    /**
     * 在外部浏览器里打开一个地址。
     *
     * 给「更多说明看文档」这类出口：教程讲得完的东西讲完了，讲不完的该把人送到文档去，
     * 而不是在字幕里念一串网址让人手抄。
     */
    | {
          kind: 'openUrl';
          url: string;
          labelKey: string;
      };

export type PonderSceneScript = {
    id: string;
    titleKey: string;
    /** 这一章讲的那个设置在哪儿，给一个直接跳过去的入口。 */
    action?: PonderSceneAction;
    anchors: Record<string, PonderAnchorSource>;
    steps: PonderStep[];
    /**
     * 这一章此刻讲不讲得通。
     *
     * 目标是按组件划分的，一个组件里却不是每件事都始终存在：进度条右边那两个槽位
     * 可以放十个动作中的任意两个，「随机其实是洗一次牌」这一章只有在真的放着随机时
     * 才该出现 —— 否则是在讲一个屏幕上根本没有的按钮。
     * 不给就是始终适用。进入教程时求值一次。
     */
    isAvailable?: () => boolean;
};

export type PonderTargetDefinition = {
    id: PonderTargetId;
    /** i18n key，标题栏「💡 思索 · <名称>」和命令面板列表共用。 */
    titleKey: string;
    /** 导航页把它排在哪一组。必填 —— 漏了就等于这个目标在导航页上不存在。 */
    category: PonderTargetCategory;
    /** 导航页卡片上的一句话。不给就只显示标题。 */
    summaryKey?: string;
    /**
     * 悬停命中用的选择器。`null` 表示这个目标在真实 DOM 里没有稳定落点，
     * 只能从命令面板的思索列表进入。
     */
    hoverSelector: string | null;
    /**
     * 此刻教它有没有意义。必须和被教组件自己的启用判断读同一个真源，
     * 否则会出现「面板已展开、滑动手势本身是关的，却还在提示教它」。
     */
    isAvailable?: () => boolean;
    /**
     * 同一个元素被多个目标的选择器同时命中、且命中深度一样时，取 priority 大的。
     *
     * 槽位按钮就是这种情况：它既属于「这两个位置的按钮可以换」，也属于「随机播放在
     * Folia 里是另一回事」。默认 0。
     */
    priority?: number;
    /** 页面教程可以列出本页仍有独立教程的组件，并让用户直接进入。 */
    relatedTargetIds?: PonderTargetId[];
    scenes: PonderSceneScript[];
};

/** compilePonderScene 的产物：铺平后的时间线，不含任何动画库概念。 */
export type PonderTimelineEntry = { step: PonderStep; atMs: number; durationMs: number };

export type PonderKeyframe = { stepId: string; atMs: number };

export type PonderTimelinePlan = {
    totalMs: number;
    entries: PonderTimelineEntry[];
    keyframes: PonderKeyframe[];
};

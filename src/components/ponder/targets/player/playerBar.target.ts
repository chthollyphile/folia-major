import { usePlayerBottomBarLayoutStore } from '../../../../stores/usePlayerBottomBarLayoutStore';
import { CAPSULE_QUICK_ACTIONS_GEOMETRY as Q, PLAYER_BAR_GEOMETRY as G } from '../../surfaces/player/playerBar.geometry';
import type { PonderAnchorSource, PonderSceneScript, PonderSurfaceKind, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/player/playerBar.target.ts
// 底部控制条整条，作为一个目标。
//
// 按组件而不是按按钮划分：用户是对着这条胶囊大致比划着按 G 的，指望他先精确命中
// 右边某个 20px 的槽位按钮再按，等于这些教程没人看得到。
//
// 胶囊本身是合成的完整尺寸，不量真实 DOM：真实那条平时收成一根进度条、指针靠近才展开，
// 还会被整体缩放，进教程那一刻量到的多半不是要讲的那个形态。几何见 playerBar.geometry，
// 合成界面和这里的锚点共用同一组数。
//
// 章节也不再按「槽位里此刻放着什么」筛：随机和音量是 Folia 和别的播放器差得最远的两处，
// 恰恰是没把它们放进槽位的人更需要知道它们存在。合成界面里直接把按钮换成要讲的那个。

const bar = {
    kind: 'synthetic',
    rect: { left: 0.5, top: 0.62, width: 0.62, height: 0.13, anchorX: 'center' },
    role: 'surface',
    surfaceKind: 'player-bar',
    // 它是一条胶囊，不是圆角矩形。合成锚点没有可量的对象，只能自己声明。
    radius: '9999px',
    labelKey: 'ponder.anchors.playerBar.bar',
} satisfies PonderAnchorSource;

/** 胶囊里的一块区域：只提供几何，框不画出来 —— 合成界面已经把控件画在同一位置了。 */
const region = (
    rect: (typeof G)[keyof typeof G],
    labelKey: string,
): PonderAnchorSource => ({ kind: 'relative', from: 'bar', rect, role: 'region', labelKey });

export const BAR_ANCHORS = {
    bar,
    play: region(G.play, 'ponder.anchors.playerBar.play'),
    title: region(G.title, 'ponder.anchors.playerBar.title'),
    progress: region(G.progress, 'ponder.anchors.playerBar.progress'),
    slots: region(G.slots, 'ponder.anchors.playerBar.slots'),
    primarySlot: region(G.primarySlot, 'ponder.anchors.playerBar.primarySlot'),
    secondarySlot: region(G.secondarySlot, 'ponder.anchors.playerBar.secondarySlot'),
} satisfies PonderSceneScript['anchors'];

/**
 * 一块居中的合成面板，各章各自取自己那一块。
 *
 * 合成面板必须按章节各自声明 —— 骨架层会把解析得出的每个锚点都画出来，共用一份的话
 * 「命令面板」「设置选择器」「播放队列」「音量面板」会在每一章里全部画出来，叠成一团。
 */
const centeredSurface = (
    labelKey: string,
    width: number,
    height: number,
    top: number,
    surfaceKind: PonderSurfaceKind,
) => ({
    kind: 'synthetic' as const,
    rect: { left: 0.5, top, width, height, anchorX: 'center' as const },
    role: 'surface' as const,
    labelKey,
    surfaceKind,
    // 这几块面板都是某个动作打开的结果，等对应的 reveal 步骤才出现。
    startsHidden: true,
});

/**
 * 第一章：这条胶囊上都有什么，以及为什么它和别的播放器长得不一样。
 *
 * 放在最前面是因为后面几章讲的都是「这一处和你预期的不同」，而不同之于什么，
 * 得先把这条胶囊整个交代一遍才说得清。
 */
const barBasics: PonderSceneScript = {
    id: 'player-bar-basics',
    titleKey: 'ponder.scenes.playerBarBasics',
    anchors: BAR_ANCHORS,
    steps: [
        { kind: 'highlight', id: 'showBar', anchor: 'bar', intensity: [0, 0.35], durationMs: 520, keyframe: true },
        {
            kind: 'caption',
            id: 'intro',
            textKey: 'ponder.captions.playerBar.basicsIntro',
            pointTo: { anchor: 'bar' },
            durationMs: 4600,
            withPrevious: true,
        },
        { kind: 'pause', id: 'readIntro' },

        // 整条的高亮到这里退场，后面几处才看得出被单独点名。
        { kind: 'highlight', id: 'dimBar', anchor: 'bar', intensity: [0.35, 0], durationMs: 420, keyframe: true },
        { kind: 'highlight', id: 'markPlay', anchor: 'play', intensity: [0, 0.9], durationMs: 420, withPrevious: true },
        {
            kind: 'caption',
            id: 'play',
            textKey: 'ponder.captions.playerBar.basicsPlay',
            pointTo: { anchor: 'play' },
            durationMs: 4200,
            withPrevious: true,
        },
        { kind: 'pause', id: 'readPlay' },

        { kind: 'cursor', id: 'hoverTitle', to: { anchor: 'title' }, durationMs: 620, keyframe: true },
        { kind: 'surfaceState', id: 'titleNav', anchor: 'bar', state: 'title-hovered', durationMs: 460 },
        {
            kind: 'caption',
            id: 'title',
            textKey: 'ponder.captions.playerBar.basicsTitle',
            pointTo: { anchor: 'title' },
            durationMs: 5200,
            withPrevious: true,
        },
        { kind: 'pause', id: 'readTitle' },

        {
            kind: 'drag',
            id: 'seek',
            from: { anchor: 'progress', x: 0.42, y: 0.3 },
            to: { anchor: 'progress', x: 0.72, y: 0.3 },
            durationMs: 900,
            keyframe: true,
        },
        {
            kind: 'caption',
            id: 'progress',
            textKey: 'ponder.captions.playerBar.basicsProgress',
            pointTo: { anchor: 'progress' },
            durationMs: 4600,
            withPrevious: true,
        },
        { kind: 'pause', id: 'readProgress' },

        { kind: 'highlight', id: 'markSlots', anchor: 'primarySlot', intensity: [0, 0.9], durationMs: 420, keyframe: true },
        { kind: 'highlight', id: 'markSlots2', anchor: 'secondarySlot', intensity: [0, 0.9], durationMs: 420, withPrevious: true },
        {
            kind: 'caption',
            id: 'slots',
            textKey: 'ponder.captions.playerBar.basicsSlots',
            pointTo: { anchor: 'slots' },
            durationMs: 5000,
            withPrevious: true,
        },
        { kind: 'pause', id: 'readSlots' },

        // 高亮是骨架层画的，不在合成界面里 —— 胶囊收起来它们不会跟着走，得显式熄掉。
        { kind: 'highlight', id: 'dimPlay', anchor: 'play', intensity: [0.9, 0], durationMs: 420, keyframe: true },
        { kind: 'highlight', id: 'dimPrimary', anchor: 'primarySlot', intensity: [0.9, 0], durationMs: 420, withPrevious: true },
        { kind: 'highlight', id: 'dimSecondary', anchor: 'secondarySlot', intensity: [0.9, 0], durationMs: 420, withPrevious: true },
        { kind: 'surfaceState', id: 'collapse', anchor: 'bar', state: 'collapsed', durationMs: 620, withPrevious: true },
        {
            kind: 'caption',
            id: 'collapsed',
            textKey: 'ponder.captions.playerBar.basicsCollapsed',
            pointTo: { anchor: 'bar' },
            durationMs: 4400,
            withPrevious: true,
        },
        { kind: 'pause', id: 'readCollapsed' },

        // 「只有悬停才展开」是错的：暂停且不在首页时它自己就展开着。少了这一句，
        // 暂停时看到一条完整胶囊的人会以为是别的什么把它撑开了。
        {
            kind: 'caption',
            id: 'autoExpand',
            textKey: 'ponder.captions.playerBar.basicsAutoExpand',
            pointTo: { anchor: 'bar' },
            durationMs: 6200,
            keyframe: true,
        },
        { kind: 'pause', id: 'settle' },
    ],
};

/**
 * 第二章：指针停一下，上方浮出一排快捷操作；最右那颗把命令窗口从胶囊原地长出来。
 *
 * 单独成章，而不是塞进第一章：浮出来的那排和长出来的窗口都只能放出来、收不回去，
 * 放在第一章里，后面「移开指针收成一根进度条」那一步会被它们盖着。
 */
const quickActions: PonderSceneScript = {
    id: 'player-bar-quick-actions',
    titleKey: 'ponder.scenes.playerBarQuickActions',
    anchors: {
        ...BAR_ANCHORS,
        /** 胶囊正上方那一排，比胶囊窄得多，也是一条胶囊。 */
        quickActions: {
            kind: 'synthetic',
            rect: { left: 0.5, top: 0.535, width: 0.3, height: 0.065, anchorX: 'center' },
            role: 'surface',
            surfaceKind: 'capsule-quick-actions',
            radius: '9999px',
            labelKey: 'ponder.anchors.playerBar.quickActions',
            startsHidden: true,
        },
        paletteButton: {
            kind: 'relative',
            from: 'quickActions',
            rect: Q.paletteButton,
            role: 'region',
            labelKey: 'ponder.anchors.playerBar.paletteButton',
        },
        /**
         * 从胶囊长出来的窗口：下沿和胶囊齐平，往上长，比胶囊略宽 —— 真实的也是，胶囊这时整条让开。
         * 声明在那一排后面，画在它上面。
         */
        capsulePalette: {
            kind: 'synthetic',
            rect: { left: 0.5, top: 0.27, width: 0.66, height: 0.48, anchorX: 'center' },
            role: 'surface',
            surfaceKind: 'capsule-palette',
            labelKey: 'ponder.anchors.playerBar.capsulePalette',
            startsHidden: true,
        },
    },
    steps: [
        { kind: 'cursor', id: 'rest', to: { anchor: 'title' }, durationMs: 620, keyframe: true },
        { kind: 'reveal', id: 'rowFloats', anchor: 'quickActions', transition: 'slide-up', durationMs: 420 },
        {
            kind: 'caption',
            id: 'intro',
            textKey: 'ponder.captions.playerBar.quickIntro',
            pointTo: { anchor: 'quickActions' },
            durationMs: 6200,
            withPrevious: true,
        },
        { kind: 'pause', id: 'readIntro' },

        { kind: 'cursor', id: 'pressPalette', to: { anchor: 'paletteButton' }, press: 'tap', durationMs: 620, keyframe: true },
        { kind: 'reveal', id: 'paletteGrows', anchor: 'capsulePalette', transition: 'slide-up', durationMs: 520 },
        {
            kind: 'caption',
            id: 'palette',
            textKey: 'ponder.captions.playerBar.quickPalette',
            pointTo: { anchor: 'capsulePalette' },
            durationMs: 5400,
            withPrevious: true,
        },
        { kind: 'pause', id: 'readPalette' },

        {
            kind: 'caption',
            id: 'otherWays',
            textKey: 'ponder.captions.playerBar.quickOther',
            pointTo: { anchor: 'capsulePalette' },
            durationMs: 5000,
            keyframe: true,
        },
        { kind: 'pause', id: 'settle' },
    ],
};

/** 第三章：整条可以拖着改高度，但要先进定位模式。 */
const adjustHeight: PonderSceneScript = {
    id: 'player-bar-height',
    titleKey: 'ponder.scenes.playerBarHeight',
    action: {
        kind: 'openSettings',
        anchorId: 'bottomUiSettings',
        labelKey: 'ponder.actions.openBottomUiSettings',
    },
    anchors: {
        ...BAR_ANCHORS,
        /** 抬高之后它会在的位置，由当前位置向上推导。 */
        raised: {
            kind: 'derived',
            from: 'bar',
            at: { anchor: 'bar', x: 0.5, y: 0.5, offset: { y: -150 } },
            size: { width: 360, height: 56 },
            role: 'rail',
            // 落点是拖上去之后才有的，先摆在那里等于剧透。
            startsHidden: true,
        },
        // 演的是设置里那一组，因为章节底下那个快速入口按钮去的正是这里。
        settings: centeredSurface('ponder.anchors.playerBar.bottomUiSettings', 0.42, 0.26, 0.10, 'bottom-ui-settings'),
    },
    steps: [
        { kind: 'highlight', id: 'showBar', anchor: 'bar', intensity: [0, 0.6], durationMs: 460 },
        {
            kind: 'caption',
            id: 'intro',
            textKey: 'ponder.captions.playerBar.heightIntro',
            pointTo: { anchor: 'bar' },
            durationMs: 3400,
            withPrevious: true,
        },
        { kind: 'pause', id: 'readIntro' },

        { kind: 'reveal', id: 'settingsOpens', anchor: 'settings', transition: 'zoom', durationMs: 520, keyframe: true },
        {
            kind: 'caption',
            id: 'settings',
            textKey: 'ponder.captions.playerBar.heightSettings',
            pointTo: { anchor: 'settings' },
            durationMs: 6200,
            withPrevious: true,
        },
        { kind: 'pause', id: 'readSettings' },

        { kind: 'cursor', id: 'grab', to: { anchor: 'bar' }, press: 'down', durationMs: 420, keyframe: true },
        { kind: 'drag', id: 'lift', from: { anchor: 'bar' }, to: { anchor: 'raised' }, durationMs: 900, ease: 'outCubic' },
        { kind: 'reveal', id: 'ghost', anchor: 'raised', transition: 'slide-up', durationMs: 900, withPrevious: true },
        {
            kind: 'caption',
            id: 'drag',
            textKey: 'ponder.captions.playerBar.heightDrag',
            pointTo: { anchor: 'raised' },
            durationMs: 3600,
            withPrevious: true,
        },
        { kind: 'pause', id: 'settle' },
    ],
};

/**
 * 第四章：右边那两个位置的按钮可以换，而且就在按钮上换。
 *
 * 演的是按住：外圈画满、正上方弹出浮层。右键是同一件事，字幕里一句带过；
 * 章节底下的按钮仍然去设置里那一组，那里能一次改两个。
 */
const swappableSlots: PonderSceneScript = {
    id: 'player-bar-slots',
    titleKey: 'ponder.scenes.playerBarSlots',
    action: {
        kind: 'openSettings',
        anchorId: 'bottomUiSettings',
        labelKey: 'ponder.actions.openSlotPicker',
    },
    anchors: {
        ...BAR_ANCHORS,
        /** 弹在第一个槽位正上方的浮层，和真实的一样贴着胶囊上沿。 */
        picker: {
            kind: 'synthetic',
            rect: { left: 0.735, top: 0.33, width: 0.25, height: 0.27, anchorX: 'center' },
            role: 'surface',
            surfaceKind: 'slot-picker',
            labelKey: 'ponder.anchors.playerBar.picker',
            startsHidden: true,
        },
    },
    steps: [
        { kind: 'highlight', id: 'markPrimary', anchor: 'primarySlot', intensity: [0, 1], durationMs: 460, keyframe: true },
        { kind: 'highlight', id: 'markSecondary', anchor: 'secondarySlot', intensity: [0, 1], durationMs: 460, withPrevious: true },
        {
            kind: 'caption',
            id: 'intro',
            textKey: 'ponder.captions.playerBar.slotsIntro',
            pointTo: { anchor: 'slots' },
            durationMs: 3400,
            withPrevious: true,
        },
        { kind: 'pause', id: 'readIntro' },

        { kind: 'cursor', id: 'pressDown', to: { anchor: 'primarySlot' }, press: 'down', durationMs: 620, keyframe: true },
        { kind: 'surfaceState', id: 'holding', anchor: 'bar', state: 'slots-holding', durationMs: 500 },
        {
            kind: 'caption',
            id: 'hold',
            textKey: 'ponder.captions.playerBar.slotsHold',
            pointTo: { anchor: 'primarySlot' },
            durationMs: 3600,
            withPrevious: true,
        },
        { kind: 'pause', id: 'readHold' },

        { kind: 'reveal', id: 'openPicker', anchor: 'picker', transition: 'zoom', durationMs: 460, keyframe: true },
        {
            kind: 'caption',
            id: 'pick',
            textKey: 'ponder.captions.playerBar.slotsPick',
            pointTo: { anchor: 'picker' },
            durationMs: 5600,
            withPrevious: true,
        },
        { kind: 'pause', id: 'readPick' },

        {
            kind: 'caption',
            id: 'suggest',
            textKey: 'ponder.captions.playerBar.slotsSuggest',
            pointTo: { anchor: 'slots' },
            durationMs: 4800,
            keyframe: true,
        },
        { kind: 'pause', id: 'settle' },
    ],
};

/**
 * 第五章：随机不是一个模式。
 *
 * 不按「槽位里此刻放着随机吗」来筛：没把它放上去的人更需要知道这里的随机和别处不一样，
 * 合成界面直接把第一个槽位换成随机按钮。
 */
const shuffleIsOneShot: PonderSceneScript = {
    id: 'player-bar-shuffle',
    titleKey: 'ponder.scenes.playerBarShuffle',
    anchors: {
        ...BAR_ANCHORS,
        queue: centeredSurface('ponder.anchors.playerBar.queue', 0.34, 0.34, 0.11, 'queue'),
    },
    steps: [
        { kind: 'surfaceState', id: 'putShuffle', anchor: 'bar', state: 'slots-shuffle', durationMs: 420, keyframe: true },
        { kind: 'highlight', id: 'showQueue', anchor: 'queue', intensity: [0, 0.5], durationMs: 460, withPrevious: true },
        {
            kind: 'caption',
            id: 'intro',
            textKey: 'ponder.captions.playerBar.shuffleIntro',
            pointTo: { anchor: 'primarySlot' },
            durationMs: 3600,
            withPrevious: true,
        },
        { kind: 'pause', id: 'readIntro' },

        { kind: 'cursor', id: 'press', to: { anchor: 'primarySlot' }, press: 'tap', durationMs: 620, keyframe: true },
        { kind: 'highlight', id: 'queueShuffles', anchor: 'queue', intensity: [0.5, 1], durationMs: 700 },
        {
            kind: 'caption',
            id: 'once',
            textKey: 'ponder.captions.playerBar.shuffleOnce',
            pointTo: { anchor: 'queue' },
            durationMs: 4200,
            withPrevious: true,
        },
        { kind: 'pause', id: 'settle' },
    ],
};

/** 第六章：没有常驻音量条。同样不按槽位筛。 */
const volumeInPalette: PonderSceneScript = {
    id: 'player-bar-volume',
    titleKey: 'ponder.scenes.playerBarVolume',
    anchors: {
        ...BAR_ANCHORS,
        volumeSurface: centeredSurface('ponder.anchors.playerBar.volumeSurface', 0.4, 0.22, 0.14, 'volume'),
    },
    steps: [
        { kind: 'surfaceState', id: 'putVolume', anchor: 'bar', state: 'slots-volume', durationMs: 420, keyframe: true },
        {
            kind: 'caption',
            id: 'intro',
            textKey: 'ponder.captions.playerBar.volumeIntro',
            pointTo: { anchor: 'primarySlot' },
            durationMs: 3400,
            withPrevious: true,
        },
        { kind: 'pause', id: 'readIntro' },

        { kind: 'cursor', id: 'press', to: { anchor: 'primarySlot' }, press: 'tap', durationMs: 620, keyframe: true },
        { kind: 'reveal', id: 'surfaceOpens', anchor: 'volumeSurface', transition: 'zoom', durationMs: 520 },
        {
            kind: 'caption',
            id: 'opens',
            textKey: 'ponder.captions.playerBar.volumeOpens',
            pointTo: { anchor: 'volumeSurface' },
            durationMs: 3800,
            withPrevious: true,
        },
        { kind: 'pause', id: 'settle' },
    ],
};

export default {
    id: 'player-bar',
    titleKey: 'ponder.targets.playerBar',
    category: 'playback',
    summaryKey: 'ponder.summaries.player_bar',
    hoverSelector: '[data-ponder="player-bar"]',
    // 已经在定位模式里了就不必教了，那时整条胶囊本来就是个被拖的物体。
    isAvailable: () => !usePlayerBottomBarLayoutStore.getState().isPositioning,
    scenes: [barBasics, quickActions, adjustHeight, swappableSlots, shuffleIsOneShot, volumeInPalette],
} satisfies PonderTargetDefinition;
